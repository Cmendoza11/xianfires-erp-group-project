import { fn, col, Op } from "sequelize";
import { Employee, Department, Attendance, Leave, Payroll } from "../models/index.js";
import { asyncHandler, findEmployeeForUser } from "../utils/helpers.js";
import { localDateISO, startOfMonthISO, formatMoney, formatDate } from "../utils/format.js";

const WEEK_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Monday-to-Sunday dates for the week containing today.
const currentWeekDates = (base = new Date()) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const offset = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  return WEEK_LABELS.map((_, i) =>
    localDateISO(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))
  );
};

const countByStatus = async () => {
  const rows = await Employee.findAll({
    attributes: ["status", [fn("COUNT", col("id")), "count"]],
    group: ["status"],
    raw: true
  });
  const result = { total: 0, Active: 0, "On Leave": 0, Resigned: 0 };
  rows.forEach((row) => {
    const n = Number(row.count) || 0;
    result[row.status] = n;
    result.total += n;
  });
  return result;
};

export const dashboard = asyncHandler(async (req, res) => {
  const today = localDateISO();
  const monthStart = startOfMonthISO();
  const monthEnd = localDateISO(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
  const weekDates = currentWeekDates();

  // Employees (and any limited role) get a personal dashboard only.
  if (res.locals.isLimited) {
    const employee = await findEmployeeForUser(req.user);

    if (!employee) {
      return res.render("dashboard", {
        title: "Dashboard | DJs HRMS",
        personal: true,
        noEmployeeRecord: true
      });
    }

    const [attendance, leaves, payslips] = await Promise.all([
      Attendance.findAll({
        where: { employeeId: employee.id, date: { [Op.between]: [monthStart, monthEnd] } },
        order: [["date", "DESC"]]
      }),
      Leave.findAll({ where: { employeeId: employee.id }, order: [["createdAt", "DESC"]] }),
      // Draft payroll is still being prepared by HR, so employees see only Processed and Paid.
      Payroll.findAll({ where: { employeeId: employee.id, status: { [Op.ne]: "Draft" } }, order: [["periodEnd", "DESC"]], limit: 5 })
    ]);

    const presentThisMonth = attendance.filter((a) => ["Present", "Late", "Half Day"].includes(a.status)).length;
    const pendingLeaves = leaves.filter((l) => l.status === "Pending").length;
    const approvedLeaveDays = leaves
      .filter((l) => l.status === "Approved" && String(l.startDate).startsWith(String(new Date().getFullYear())))
      .reduce((sum, l) => sum + Number(l.days || 0), 0);

    return res.render("dashboard", {
      title: "Dashboard | DJs HRMS",
      personal: true,
      employee: employee.toJSON(),
      stats: { presentThisMonth, pendingLeaves, approvedLeaveDays },
      recentAttendance: attendance.slice(0, 5).map((a) => a.toJSON()),
      recentLeaves: leaves.slice(0, 5).map((l) => l.toJSON()),
      latestPayslip: payslips[0] ? payslips[0].toJSON() : null,
      today
    });
  }

  const [
    statusCounts,
    departments,
    deptCounts,
    recentEmployees,
    todayAttendance,
    pendingLeaves,
    pendingLeaveCount,
    monthPayroll,
    weekAttendance,
    newThisMonth
  ] = await Promise.all([
    countByStatus(),
    Department.findAll({ order: [["name", "ASC"]] }),
    Employee.findAll({
      attributes: ["department", [fn("COUNT", col("id")), "count"]],
      group: ["department"],
      raw: true
    }),
    Employee.findAll({ order: [["createdAt", "DESC"]], limit: 5 }),
    Attendance.findAll({ where: { date: today } }),
    Leave.findAll({
      where: { status: "Pending" },
      include: [{ model: Employee, as: "employee" }],
      order: [["createdAt", "ASC"]],
      limit: 5
    }),
    Leave.count({ where: { status: "Pending" } }),
    Payroll.findAll({ where: { periodStart: { [Op.between]: [monthStart, monthEnd] } } }),
    Attendance.findAll({ where: { date: { [Op.in]: weekDates } } }),
    Employee.count({ where: { createdAt: { [Op.gte]: new Date(monthStart) } } })
  ]);

  const departmentStats = departments
    .map((d) => ({
      name: d.name,
      count: Number((deptCounts.find((c) => c.department === d.name) || {}).count || 0)
    }))
    .sort((a, b) => b.count - a.count);

  const maxDeptCount = Math.max(1, ...departmentStats.map((d) => d.count));
  departmentStats.forEach((d) => {
    d.pct = Math.round((d.count / maxDeptCount) * 100);
  });

  const weekly = weekDates.map((date, i) => {
    const rows = weekAttendance.filter((a) => String(a.date) === date);
    return {
      label: WEEK_LABELS[i],
      present: rows.filter((a) => ["Present", "Half Day"].includes(a.status)).length,
      absentLate: rows.filter((a) => ["Absent", "Late"].includes(a.status)).length,
      total: rows.length
    };
  });

  const weeklyMax = Math.max(1, ...weekly.map((w) => w.present + w.absentLate));
  weekly.forEach((w) => {
    w.presentPct = Math.round((w.present / weeklyMax) * 100);
    w.absentPct = Math.round((w.absentLate / weeklyMax) * 100);
  });

  const presentToday = todayAttendance.filter((a) => ["Present", "Late", "Half Day"].includes(a.status)).length;
  const payrollTotal = monthPayroll.reduce((sum, p) => sum + Number(p.netSalary || 0), 0);

  // Bell dropdown: what needs attention. Payroll items are for the admin only (staff cannot open Payroll).
  const notifications = pendingLeaves.map((l) => ({
    icon: "i-calendar",
    tone: "yellow",
    title: `${l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : "An employee"} filed ${l.type} leave`,
    detail: `${formatDate(l.startDate)}${l.endDate !== l.startDate ? ` – ${formatDate(l.endDate)}` : ""} · ${l.days} day(s) · waiting for review`,
    href: "/leaves?status=Pending"
  }));
  if (pendingLeaveCount > pendingLeaves.length) {
    notifications.push({ icon: "i-calendar", tone: "yellow", title: `${pendingLeaveCount - pendingLeaves.length} more pending leave request(s)`, detail: "Open Leave Management to review them", href: "/leaves?status=Pending" });
  }
  if (res.locals.isAdmin) {
    const draftPayroll = monthPayroll.filter((p) => p.status === "Draft").length; // this month, like the link
    const [unposted, failed] = await Promise.all([
      Payroll.count({ where: { status: "Paid", accountingSyncStatus: "Pending" } }),
      Payroll.count({ where: { status: "Paid", accountingSyncStatus: "Failed" } })
    ]);
    if (draftPayroll) notifications.push({ icon: "i-wallet", tone: "blue", title: `${draftPayroll} payroll draft(s) to review`, detail: "Check the amounts, then set them to Processed or Paid", href: `/payroll?status=Draft&month=${monthStart.slice(0, 7)}` });
    if (failed) notifications.push({ icon: "i-alert", tone: "red", title: `${failed} paid payroll could not be posted to Accounting`, detail: "Open the payslip and use Retry posting", href: "/payroll?status=Paid" });
    if (unposted) notifications.push({ icon: "i-alert", tone: "orange", title: `${unposted} paid payroll waiting for Accounting`, detail: "Accounting is not reachable yet; HR retries every minute", href: "/payroll?status=Paid" });
  }

  res.render("dashboard", {
    title: "Dashboard | DJs HRMS",
    personal: false,
    stats: {
      ...statusCounts,
      presentToday,
      presentPercent: statusCounts.total ? Math.round((presentToday / statusCounts.total) * 100) : 0,
      lateToday: todayAttendance.filter((a) => a.status === "Late").length,
      pendingLeaves: pendingLeaveCount,
      payrollTotal: formatMoney(payrollTotal),
      payrollCount: monthPayroll.length,
      newThisMonth
    },
    weekly,
    departmentStats,
    recentEmployees: recentEmployees.map((e) => e.toJSON()),
    recentLeaves: pendingLeaves.map((l) => l.toJSON()),
    notifications,
    today,
    monthLabel: formatDate(monthStart)
  });
});
