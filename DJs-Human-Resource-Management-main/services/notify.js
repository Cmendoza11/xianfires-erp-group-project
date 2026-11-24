/*
  Creates notifications (models/NotificationModel.js) for the bell and /notifications.

    notifyRoles(["admin", "staff"], { title, detail, href, icon, tone, type }, { except: req.user?.id })
    notifyEmployee(employeeId, {...})   the account linked to that employee record, if any
    notifyUsers([userId, ...], {...})

  Never throws: a notification that cannot be saved must not undo the action that caused it.
  tone: yellow | green | blue | orange | red. icon: an id from views/partials/icons.xian.
*/
import { Op } from "sequelize";
import { User, Notification, Leave, Employee, PasswordRequest } from "../models/index.js";

const clip = (value, max) => (value == null ? null : String(value).slice(0, max));

export async function notifyUsers(userIds, data) {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return;
    await Notification.bulkCreate(ids.map((userId) => ({
      userId,
      type: clip(data.type || "general", 40),
      title: clip(data.title, 200),
      detail: clip(data.detail, 255),
      href: clip(data.href, 255),
      icon: data.icon || "i-bell",
      tone: data.tone || "yellow"
    })));
  } catch (error) {
    console.error("[notify]", error.message);
  }
}

/** Every account with one of these roles, except the person who did the action. */
export async function notifyRoles(roles, data, { except = null } = {}) {
  try {
    const where = { role: { [Op.in]: roles } };
    if (except) where.id = { [Op.ne]: except };
    const users = await User.findAll({ where, attributes: ["id"] });
    await notifyUsers(users.map((u) => u.id), data);
  } catch (error) {
    console.error("[notify]", error.message);
  }
}

/** The login account linked to an employee record (nothing when the employee has no account). */
export async function notifyEmployee(employeeId, data) {
  try {
    if (!employeeId) return;
    const users = await User.findAll({ where: { employeeId }, attributes: ["id"] });
    await notifyUsers(users.map((u) => u.id), data);
  } catch (error) {
    console.error("[notify]", error.message);
  }
}

/**
 * First start with notifications: turn what is already waiting (pending leaves, password requests)
 * into notifications, so the bell is not empty after the upgrade. Runs only while the table is empty.
 */
export async function backfillNotifications() {
  try {
    if ((await Notification.count()) > 0) return;
    const leaves = await Leave.findAll({
      where: { status: "Pending" },
      include: [{ model: Employee, as: "employee", attributes: ["firstName", "lastName"] }],
      order: [["createdAt", "ASC"]]
    });
    for (const l of leaves) {
      const who = l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : "An employee";
      await notifyRoles(["admin", "staff"], {
        type: "leave", icon: "i-calendar", tone: "yellow",
        title: `${who} filed ${l.type} leave`,
        detail: `${l.startDate}${l.endDate !== l.startDate ? ` to ${l.endDate}` : ""} · ${l.days} day(s) · waiting for review`,
        href: "/leaves?status=Pending"
      });
    }
    const requests = await PasswordRequest.findAll({
      where: { status: "Pending" },
      include: [{ model: User, as: "user", attributes: ["name", "email"] }]
    });
    for (const r of requests.filter((x) => x.user)) {
      await notifyRoles(["admin"], {
        type: "password", icon: "i-key", tone: "orange",
        title: `${r.user.name} forgot their password`,
        detail: `${r.user.email} · approve it in User Accounts`,
        href: "/users#password-requests"
      });
    }
  } catch (error) {
    console.error("[notify] backfill:", error.message);
  }
}
