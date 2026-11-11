import { Op } from "sequelize";
import { Employee, Department, Attendance, Leave, Payroll } from "../models/index.js";
import { asyncHandler } from "../utils/helpers.js";
import { formatDate, formatTime, formatMoney, startOfMonthISO, localDateISO } from "../utils/format.js";

const REPORT_TYPES = ["employees", "departments", "attendance", "leaves", "payroll"];

const REPORT_META = {
  employees: { label: "Employee Report", description: "Headcount, assignments and employment status." },
  departments: { label: "Department Report", description: "Department heads and employee distribution." },
  attendance: { label: "Attendance Report", description: "Daily attendance, lateness and absences." },
  leaves: { label: "Leave Report", description: "Leave requests and approval outcomes." },
  payroll: { label: "Payroll Report", description: "Compensation totals for the period." }
};

export const reportsIndex = (req, res) => {
  const types = res.locals.isAdmin
    ? REPORT_TYPES
    : REPORT_TYPES.filter((type) => type !== "payroll");

  res.render("reports", {
    title: "Reports | DJs HRMS",
    reports: types.map((type) => ({ type, ...REPORT_META[type] })),
    from: startOfMonthISO(),
    to: localDateISO()
  });
};

export const reportShow = asyncHandler(async (req, res) => {
  const type = String(req.params.type || "");
  const allowed = res.locals.isAdmin ? REPORT_TYPES : REPORT_TYPES.filter((t) => t !== "payroll");

  if (!allowed.includes(type)) {
    return res.status(403).render("403", { title: "Access Denied | DJs HRMS" });
  }

  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : startOfMonthISO();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : localDateISO();

  let report = { title: REPORT_META[type].label, subtitle: REPORT_META[type].description, columns: [], rows: [], summary: [] };

  if (type === "employees") {
    const employees = await Employee.findAll({ order: [["lastName", "ASC"]] });
    const columns = ["Employee ID", "Name", "Department", "Position", "Status", "Date Hired"];
    if (res.locals.isAdmin) columns.push("Monthly Salary");

    report = {
      title: "Employee Report",
      subtitle: `${employees.length} employee record(s) · generated ${formatDate(localDateISO())}`,
      columns,
      rows: employees.map((e) => {
        const row = [e.employeeCode, `${e.firstName} ${e.lastName}`, e.department, e.position, e.status, formatDate(e.dateHired)];
        if (res.locals.isAdmin) row.push(formatMoney(e.salary));
        return row;
      }),
      summary: [
        { label: "Total employees", value: String(employees.length) },
        { label: "Active", value: String(employees.filter((e) => e.status === "Active").length) },
        { label: "On leave", value: String(employees.filter((e) => e.status === "On Leave").length) },
        { label: "Resigned", value: String(employees.filter((e) => e.status === "Resigned").length) }
      ]
    };
  }

  if (type === "departments") {
    const departments = await Department.findAll({
      include: [{ model: Employee, as: "head", attributes: ["firstName", "lastName"] }],
      order: [["name", "ASC"]]
    });
    const employees = await Employee.findAll();

    report = {
      title: "Department Report",
      subtitle: `${departments.length} department(s) · generated ${formatDate(localDateISO())}`,
      columns: ["Department", "Code", "Head", "Employees"],
      rows: departments.map((d) => [
        d.name,
        d.code || "—",
        d.head ? `${d.head.firstName} ${d.head.lastName}` : "Unassigned",
        String(employees.filter((e) => e.department === d.name).length)
      ]),
      summary: [{ label: "Total departments", value: String(departments.length) }]
    };
  }

  if (type === "attendance") {
    const records = await Attendance.findAll({
      where: { date: { [Op.between]: [from, to] } },
      include: [{ model: Employee, as: "employee" }],
      order: [["date", "DESC"]]
    });

    report = {
      title: "Attendance Report",
      subtitle: `${formatDate(from)} – ${formatDate(to)} · ${records.length} record(s)`,
      columns: ["Date", "Employee", "Department", "Check In", "Check Out", "Status", "Late (min)"],
      rows: records.map((r) => [
        formatDate(r.date),
        r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : "—",
        r.employee?.department || "—",
        formatTime(r.checkIn),
        formatTime(r.checkOut),
        r.status,
        String(r.lateMinutes || 0)
      ]),
      summary: [
        { label: "Present", value: String(records.filter((r) => r.status === "Present").length) },
        { label: "Late", value: String(records.filter((r) => r.status === "Late").length) },
        { label: "Absent", value: String(records.filter((r) => r.status === "Absent").length) },
        { label: "Half day", value: String(records.filter((r) => r.status === "Half Day").length) }
      ]
    };
  }

  if (type === "leaves") {
    const records = await Leave.findAll({
      where: { startDate: { [Op.lte]: to }, endDate: { [Op.gte]: from } },
      include: [{ model: Employee, as: "employee" }],
      order: [["startDate", "DESC"]]
    });

    report = {
      title: "Leave Report",
      subtitle: `${formatDate(from)} – ${formatDate(to)} · ${records.length} request(s)`,
      columns: ["Employee", "Type", "From", "To", "Days", "Status"],
      rows: records.map((l) => [
        l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : "—",
        l.type,
        formatDate(l.startDate),
        formatDate(l.endDate),
        String(l.days),
        l.status
      ]),
      summary: [
        { label: "Pending", value: String(records.filter((l) => l.status === "Pending").length) },
        { label: "Approved", value: String(records.filter((l) => l.status === "Approved").length) },
        { label: "Rejected", value: String(records.filter((l) => l.status === "Rejected").length) },
        { label: "Days requested", value: String(records.reduce((s, l) => s + Number(l.days || 0), 0)) }
      ]
    };
  }

  if (type === "payroll") {
    const records = await Payroll.findAll({
      where: { periodStart: { [Op.between]: [from, to] } },
      include: [{ model: Employee, as: "employee" }],
      order: [["periodEnd", "DESC"]]
    });

    report = {
      title: "Payroll Report",
      subtitle: `${formatDate(from)} – ${formatDate(to)} · ${records.length} record(s)`,
      columns: ["Employee", "Period", "Basic", "Allowances", "Overtime", "Deductions", "Net Pay", "Status"],
      rows: records.map((p) => [
        p.employee ? `${p.employee.firstName} ${p.employee.lastName}` : "—",
        `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`,
        formatMoney(p.basicSalary),
        formatMoney(p.allowances),
        formatMoney(p.overtime),
        formatMoney(p.deductions),
        formatMoney(p.netSalary),
        p.status
      ]),
      summary: [
        { label: "Records", value: String(records.length) },
        { label: "Total net pay", value: formatMoney(records.reduce((s, p) => s + Number(p.netSalary || 0), 0)) },
        { label: "Paid", value: String(records.filter((p) => p.status === "Paid").length) }
      ]
    };
  }

  res.render("report", {
    title: `${report.title} | DJs HRMS`,
    report,
    type,
    from,
    to,
    showRange: ["attendance", "leaves", "payroll"].includes(type)
  });
});
