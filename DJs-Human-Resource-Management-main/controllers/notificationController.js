/*
  The signed-in user's own notifications (services/notify.js makes them).
    GET  /notifications                 all, newest first, 9 per page (?show=unread for unread only)
    GET  /notifications/:id/open        marks it read and goes to its page
    POST /notifications/:id/read        read=1 marks read, read=0 marks unread
    POST /notifications/:id/delete
    POST /notifications/read-all
    POST /notifications/delete-all
  Every query is limited to req.user.id, so nobody can touch another person's notifications.
*/
import { Notification } from "../models/index.js";
import { asyncHandler, parseId, pageInfo } from "../utils/helpers.js";

// Back to the page the form was on (same site only), else the notifications page.
const back = (req) => {
  try {
    const ref = new URL(req.get("Referer") || "", `${req.protocol}://${req.get("host")}`);
    if (ref.host === req.get("host") && ref.pathname.startsWith("/")) return ref.pathname + ref.search;
  } catch { /* no or bad referer */ }
  return "/notifications";
};

const mine = (req, id) => Notification.findOne({ where: { id: parseId(id) || 0, userId: req.user.id } });

export const notificationList = asyncHandler(async (req, res) => {
  const show = req.query.show === "unread" ? "unread" : "all";
  const where = { userId: req.user.id };
  if (show === "unread") where.readAt = null;

  const pagination = pageInfo(req, await Notification.count({ where }));
  const rows = await Notification.findAll({
    where,
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit: pagination.limit,
    offset: pagination.offset
  });

  res.render("notifications", {
    title: "Notifications | DJs HRMS",
    rows: rows.map((n) => n.toJSON()),
    pagination,
    show,
    totalCount: await Notification.count({ where: { userId: req.user.id } })
  });
});

export const notificationOpen = asyncHandler(async (req, res) => {
  const n = await mine(req, req.params.id);
  if (!n) return res.redirect("/notifications");
  if (!n.readAt) await n.update({ readAt: new Date() });
  res.redirect(n.href && n.href.startsWith("/") ? n.href : "/notifications");
});

export const notificationMarkRead = asyncHandler(async (req, res) => {
  const n = await mine(req, req.params.id);
  if (n) await n.update({ readAt: req.body.read === "0" ? null : new Date() });
  res.redirect(back(req));
});

export const notificationDelete = asyncHandler(async (req, res) => {
  const n = await mine(req, req.params.id);
  if (n) {
    await n.destroy();
    req.flash("success_msg", "Notification deleted.");
  }
  res.redirect(back(req));
});

export const notificationReadAll = asyncHandler(async (req, res) => {
  const [count] = await Notification.update({ readAt: new Date() }, { where: { userId: req.user.id, readAt: null } });
  req.flash("success_msg", count ? `${count} notification(s) marked as read.` : "No unread notifications.");
  res.redirect(back(req));
});

export const notificationDeleteAll = asyncHandler(async (req, res) => {
  const count = await Notification.destroy({ where: { userId: req.user.id } });
  req.flash("success_msg", count ? `${count} notification(s) deleted.` : "There were no notifications to delete.");
  res.redirect(back(req));
});

// Middleware for page requests: the bell's latest items and unread count (res.locals).
export async function attachNotifications(req, res, next) {
  res.locals.notifications = [];
  res.locals.unreadCount = 0;
  if (!req.user || req.method !== "GET" || req.path.startsWith("/api/")) return next();
  try {
    const [latest, unread] = await Promise.all([
      Notification.findAll({ where: { userId: req.user.id }, order: [["createdAt", "DESC"], ["id", "DESC"]], limit: 8 }),
      Notification.count({ where: { userId: req.user.id, readAt: null } })
    ]);
    res.locals.notifications = latest.map((n) => n.toJSON());
    res.locals.unreadCount = unread;
  } catch (error) {
    console.error("[notifications]", error.message); // the page still opens without the bell data
  }
  next();
}
