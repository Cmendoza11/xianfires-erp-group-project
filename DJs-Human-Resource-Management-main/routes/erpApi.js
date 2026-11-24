/*
  Internal API for the other DJ's ERP modules. HR keeps its data in its own database, so other
  modules read it only through these routes (shared X-ERP-Key; browsers never call them).

  GET  /api/v1/departments          every department with its head's name (Procurement mirrors this list)
  GET  /api/v1/erp/summary          figures for Accounting's Enterprise Overview
  GET  /api/v1/payrolls?status=     payroll for Accounting's Payroll page (status: Processed, Paid, Draft;
                                    comma-separated; default Processed,Paid)
  GET  /api/v1/payrolls/:id         one payroll with its amounts
  POST /api/v1/payrolls/:id/pay     Accounting released the salary: marks a Processed payroll Paid
                                    (body: paid_at YYYY-MM-DD, entry_number). Accounting already
                                    posted the journal entry, so HR does not post it again.
  HR approves payroll (Processed); Accounting releases it ("Release salary") and calls /pay.
*/
import express from "express";
import { Op } from "sequelize";
import { Department, Employee, Payroll } from "../models/index.js";
import { requireErpKey } from "../middleware/erpKey.js";

const router = express.Router();
router.use(requireErpKey);

const wrap = (handler) => (req, res) =>
  handler(req, res).catch((error) => {
    console.error("[hr-api]", error);
    res.status(500).json({ error: { status: 500, message: "HR could not answer" } });
  });

// This month in server-local time (the clock the other modules use), as Dates in the stored UTC.
function monthBounds(now = new Date()) {
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
}

router.get("/departments", wrap(async (req, res) => {
  const departments = await Department.findAll({
    include: [{ model: Employee, as: "head", attributes: ["firstName", "lastName"], required: false }],
    order: [["id", "ASC"]],
  });
  res.json({
    departments: departments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      description: d.description,
      head: d.head ? `${d.head.firstName || ""} ${d.head.lastName || ""}`.trim() || null : null,
    })),
  });
}));

const PAYROLL_STATUSES = ["Draft", "Processed", "Paid"];
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const isoDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const toPayroll = (p) => ({
  id: p.id,
  employee: p.employee
    ? {
        id: p.employee.id,
        code: p.employee.employeeCode,
        name: `${p.employee.firstName || ""} ${p.employee.lastName || ""}`.trim(),
        department: p.employee.department || null,
        position: p.employee.position || null,
      }
    : null,
  periodStart: p.periodStart,
  periodEnd: p.periodEnd,
  basicSalary: money(p.basicSalary),
  allowances: money(p.allowances),
  overtime: money(p.overtime),
  gross: money(Number(p.basicSalary) + Number(p.allowances) + Number(p.overtime)),
  daysWorked: Number(p.daysWorked || 0),
  overtimeHours: Number(p.overtimeHours || 0),
  sssDeduction: money(p.sssDeduction),
  philhealthDeduction: money(p.philhealthDeduction),
  pagibigDeduction: money(p.pagibigDeduction),
  cashAdvance: money(p.cashAdvance),
  deductions: money(p.deductions),
  netSalary: money(p.netSalary),
  status: p.status,
  paidAt: isoDate(p.paidAt),
  accountingEntryNumber: p.accountingEntryNumber || null,
});

const withEmployee = { model: Employee, as: "employee", attributes: ["id", "employeeCode", "firstName", "lastName", "department", "position"] };

router.get("/payrolls", wrap(async (req, res) => {
  const asked = String(req.query.status || "Processed,Paid").split(",").map((s) => s.trim()).filter((s) => PAYROLL_STATUSES.includes(s));
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
  const payrolls = await Payroll.findAll({
    where: { status: { [Op.in]: asked.length ? asked : ["Processed", "Paid"] } },
    include: [withEmployee],
    order: [["periodEnd", "DESC"], ["id", "DESC"]],
    limit,
  });
  res.json({ payrolls: payrolls.map(toPayroll) });
}));

router.get("/payrolls/:id", wrap(async (req, res) => {
  const payroll = await Payroll.findByPk(parseInt(req.params.id, 10) || 0, { include: [withEmployee] });
  if (!payroll) return res.status(404).json({ error: { status: 404, message: "Payroll not found in HR" } });
  res.json({ payroll: toPayroll(payroll) });
}));

// Accounting calls this after it posted the salary release. Safe to repeat: a payroll already Paid
// with the same entry number answers 200 again.
router.post("/payrolls/:id/pay", wrap(async (req, res) => {
  const payroll = await Payroll.findByPk(parseInt(req.params.id, 10) || 0, { include: [withEmployee] });
  if (!payroll) return res.status(404).json({ error: { status: 404, message: "Payroll not found in HR" } });
  const entryNumber = String(req.body?.entry_number || "").trim().slice(0, 50);
  if (!entryNumber) return res.status(400).json({ error: { status: 400, message: "entry_number is required" } });
  if (payroll.status === "Paid") {
    if (payroll.accountingEntryNumber === entryNumber) return res.json({ payroll: toPayroll(payroll) });
    return res.status(409).json({ error: { status: 409, message: `Payroll #${payroll.id} is already paid${payroll.accountingEntryNumber ? ` (${payroll.accountingEntryNumber})` : ""}` } });
  }
  if (payroll.status !== "Processed") {
    return res.status(409).json({ error: { status: 409, message: `Payroll #${payroll.id} is ${payroll.status}; HR must approve it (Processed) first` } });
  }
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.paid_at || "")) ? new Date(`${req.body.paid_at}T12:00:00`) : new Date();
  await payroll.update({
    status: "Paid",
    paidAt,
    accountingSyncStatus: "Synced",
    accountingEntryNumber: entryNumber,
    accountingSyncError: null,
    accountingNextAttemptAt: null
  });
  res.json({ payroll: toPayroll(payroll) });
}));

router.get("/erp/summary", wrap(async (req, res) => {
  const { from, to } = monthBounds();
  const [activeEmployees, onLeave, paid, syncRows] = await Promise.all([
    Employee.count({ where: { status: "Active" } }),
    Employee.count({ where: { status: "On Leave" } }),
    Payroll.findAll({
      where: { status: "Paid", paidAt: { [Op.gte]: from, [Op.lt]: to } },
      attributes: ["netSalary"],
      raw: true,
    }),
    Payroll.findAll({
      where: { accountingSyncStatus: { [Op.ne]: null } },
      attributes: ["accountingSyncStatus"],
      raw: true,
    }),
  ]);
  const accountingSync = { pending: 0, failed: 0, synced: 0 };
  for (const row of syncRows) {
    const key = String(row.accountingSyncStatus).toLowerCase();
    if (key in accountingSync) accountingSync[key] += 1;
  }
  res.json({
    activeEmployees,
    onLeave,
    payroll: {
      count: paid.length,
      total: Math.round(paid.reduce((sum, p) => sum + Number(p.netSalary || 0), 0) * 100) / 100,
    },
    accountingSync,
  });
}));

export default router;
