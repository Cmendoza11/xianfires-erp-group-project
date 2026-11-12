import { Op } from "sequelize";
import { Payroll, Employee } from "../models/index.js";
import { asyncHandler, parseId, parseMoney, findEmployeeForUser } from "../utils/helpers.js";
import { isValidDate } from "../utils/hr.js";
import { startOfMonthISO, endOfMonthISO, localDateISO } from "../utils/format.js";
import { isLockedByAccounting, postPayroll, queuePayroll } from "../services/accountingSync.js";
import { computePayroll, dailyRateOf, hourlyRateOf } from "../services/payrollCalc.js";

const PAYROLL_STATUSES = ["Draft", "Processed", "Paid"];
const BREAKDOWN = ["sssDeduction", "philhealthDeduction", "pagibigDeduction", "cashAdvance"];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const payrollList = asyncHandler(async (req, res) => {
  const status = PAYROLL_STATUSES.includes(req.query.status) ? req.query.status : "";
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "")
    ? req.query.month
    : localDateISO().slice(0, 7);

  const where = {
    periodStart: { [Op.between]: [`${month}-01`, `${month}-31`] }
  };
  if (status) where.status = status;

  const records = await Payroll.findAll({
    where,
    include: [
      { model: Employee, as: "employee", attributes: ["id", "firstName", "lastName", "employeeCode", "department"] }
    ],
    order: [["periodEnd", "DESC"], ["createdAt", "DESC"]]
  });

  const rows = records.map((r) => r.toJSON());
  const summary = {
    count: rows.length,
    totalNet: rows.reduce((sum, r) => sum + Number(r.netSalary || 0), 0),
    draft: rows.filter((r) => r.status === "Draft").length,
    paid: rows.filter((r) => r.status === "Paid").length
  };

  res.render("payroll", {
    title: "Payroll | DJs HRMS",
    rows,
    summary,
    month,
    status,
    statuses: PAYROLL_STATUSES
  });
});

export const payrollCreatePage = asyncHandler(async (req, res) => {
  const employees = await Employee.findAll({
    where: { status: "Active" },
    order: [["lastName", "ASC"]]
  });

  res.render("payroll-create", {
    title: "Create Payroll | DJs HRMS",
    employees: employees.map((e) => ({ ...e.toJSON(), dailyRateUsed: dailyRateOf(e), hourlyRateUsed: hourlyRateOf(e) })),
    defaultStart: startOfMonthISO(),
    defaultEnd: endOfMonthISO(),
    statuses: PAYROLL_STATUSES
  });
});

// GET /payroll/compute?employeeId=&periodStart=&periodEnd= : the amounts from attendance (DTR), for the form.
export const payrollCompute = asyncHandler(async (req, res) => {
  const employee = await Employee.findByPk(parseId(req.query.employeeId) || 0);
  const periodStart = String(req.query.periodStart || "").trim();
  const periodEnd = String(req.query.periodEnd || "").trim();
  if (!employee) return res.status(400).json({ error: "Select a valid employee." });
  if (!isValidDate(periodStart) || !isValidDate(periodEnd) || periodEnd < periodStart) {
    return res.status(400).json({ error: "Provide a valid payroll period." });
  }
  res.json({ data: await computePayroll(employee, periodStart, periodEnd) });
});

export const payrollCreate = asyncHandler(async (req, res) => {
  const body = req.body;
  const has = (field) => String(body[field] ?? "").trim() !== "";
  const employeeId = parseId(body.employeeId);
  const employee = employeeId ? await Employee.findByPk(employeeId) : null;
  const periodStart = String(body.periodStart || "").trim();
  const periodEnd = String(body.periodEnd || "").trim();
  const status = PAYROLL_STATUSES.includes(body.status) ? body.status : "Draft";

  const errors = [];
  if (!employee) errors.push("Select a valid employee.");
  if (!isValidDate(periodStart) || !isValidDate(periodEnd)) errors.push("Provide a valid payroll period.");
  if (isValidDate(periodStart) && isValidDate(periodEnd) && periodEnd < periodStart) {
    errors.push("The period end cannot be before the period start.");
  }

  // A blank basic pay means "compute everything from the attendance (DTR)"; typed amounts always win.
  const auto = !has("basicSalary");
  const computed = auto && !errors.length ? await computePayroll(employee, periodStart, periodEnd) : null;
  const pick = (field) => (has(field) ? parseMoney(body[field]) : Number(computed?.[field] ?? 0));

  const basicSalary = pick("basicSalary");
  const allowances = parseMoney(body.allowances);
  const overtime = pick("overtime");
  const withBreakdown = auto || BREAKDOWN.some(has);
  const sssDeduction = withBreakdown ? pick("sssDeduction") : 0;
  const philhealthDeduction = withBreakdown ? pick("philhealthDeduction") : 0;
  const pagibigDeduction = withBreakdown ? pick("pagibigDeduction") : 0;
  const cashAdvance = withBreakdown ? parseMoney(body.cashAdvance) : 0;
  // Older forms send only the total of the deductions.
  const deductions = round2(withBreakdown ? sssDeduction + philhealthDeduction + pagibigDeduction + cashAdvance : parseMoney(body.deductions));
  const daysWorked = has("daysWorked") ? Number(body.daysWorked) || 0 : Number(computed?.daysWorked ?? 0);
  const overtimeHours = has("overtimeHours") ? Number(body.overtimeHours) || 0 : Number(computed?.overtimeHours ?? 0);

  if (!errors.length && (!basicSalary || basicSalary < 0)) {
    errors.push(auto
      ? "No attendance (DTR) was found for this employee in this period. Record attendance first, or type the basic pay."
      : "Basic salary must be a positive amount.");
  }
  if ([allowances, overtime, deductions, sssDeduction, philhealthDeduction, pagibigDeduction, cashAdvance].some((n) => n < 0)) {
    errors.push("Amounts cannot be negative.");
  }

  if (errors.length) {
    req.flash("error_msg", errors.join(" "));
    return res.redirect("/payroll/create");
  }

  const duplicate = await Payroll.findOne({ where: { employeeId, periodStart, periodEnd } });
  if (duplicate) {
    req.flash("error_msg", "Payroll already exists for this employee and period.");
    return res.redirect("/payroll");
  }

  const netSalary = round2(basicSalary + allowances + overtime - deductions);
  if (netSalary < 0) {
    req.flash("error_msg", "Deductions are larger than the pay for this period.");
    return res.redirect("/payroll/create");
  }

  const payroll = await Payroll.create({
    employeeId,
    periodStart,
    periodEnd,
    basicSalary,
    allowances,
    overtime,
    deductions,
    netSalary,
    daysWorked,
    overtimeHours,
    sssDeduction,
    philhealthDeduction,
    pagibigDeduction,
    cashAdvance,
    status,
    processedBy: req.user.id,
    paidAt: status === "Paid" ? new Date() : null
  });
  // Paid payroll is booked in the Accounting ERP (salaries expense, deductions payable, cash).
  await queuePayroll(payroll);

  req.flash("success_msg", status === "Paid" ? "Payroll record created and sent to Accounting." : "Payroll record created.");
  res.redirect(`/payroll/${payroll.id}`);
});

export const payrollShow = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findByPk(req.params.id, {
    include: [{ model: Employee, as: "employee" }]
  });

  if (!payroll) {
    req.flash("error_msg", "Payroll record not found.");
    return res.redirect(res.locals.isLimited ? "/my-payslips" : "/payroll");
  }

  if (res.locals.isLimited) {
    const employee = await findEmployeeForUser(req.user);
    if (!employee || payroll.employeeId !== employee.id) {
      return res.status(403).render("403", { title: "Access Denied | DJs HRMS" });
    }
  }

  const data = payroll.toJSON();
  res.render("payslip", {
    title: "Payslip | DJs HRMS",
    payroll: data,
    employee: payroll.employee ? payroll.employee.toJSON() : null,
    canManage: res.locals.isAdmin,
    statuses: PAYROLL_STATUSES,
    hasBreakdown: BREAKDOWN.some((f) => Number(data[f]) > 0),
    hasDtr: Number(data.daysWorked) > 0 || Number(data.overtimeHours) > 0
  });
});

export const payrollUpdateStatus = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findByPk(req.params.id);

  if (!payroll) {
    req.flash("error_msg", "Payroll record not found.");
    return res.redirect("/payroll");
  }

  const status = PAYROLL_STATUSES.includes(req.body.status) ? req.body.status : null;
  if (!status) {
    req.flash("error_msg", "Invalid payroll status.");
    return res.redirect(`/payroll/${payroll.id}`);
  }
  if (status !== "Paid" && isLockedByAccounting(payroll)) {
    const entry = payroll.accountingEntryNumber ? ` (${payroll.accountingEntryNumber})` : "";
    req.flash("error_msg", `This payroll is already booked in Accounting${entry}, so Paid is final. Correct it in Accounting with a reversing entry.`);
    return res.redirect(`/payroll/${payroll.id}`);
  }

  await payroll.update({
    status,
    processedBy: req.user.id,
    paidAt: status === "Paid" ? payroll.paidAt || new Date() : null,
    // A payroll that failed to post and is moved back out of Paid has nothing left to post.
    ...(status !== "Paid" ? { accountingSyncStatus: null, accountingSyncError: null } : {})
  });
  await queuePayroll(payroll);

  req.flash("success_msg", status === "Paid" ? "Payroll marked as Paid and sent to Accounting." : `Payroll marked as ${status}.`);
  res.redirect(`/payroll/${payroll.id}`);
});

export const payrollDelete = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findByPk(req.params.id);

  if (!payroll) {
    req.flash("error_msg", "Payroll record not found.");
    return res.redirect("/payroll");
  }

  if (isLockedByAccounting(payroll)) {
    req.flash("error_msg", "This payroll is booked in Accounting and cannot be deleted.");
    return res.redirect(`/payroll/${payroll.id}`);
  }

  await payroll.destroy();
  req.flash("success_msg", "Payroll record deleted.");
  res.redirect("/payroll");
});

export const myPayslips = asyncHandler(async (req, res) => {
  const employee = await findEmployeeForUser(req.user);

  if (!employee) {
    return res.render("my-payslips", {
      title: "My Payslips | DJs HRMS",
      employee: null,
      rows: [],
      totalNet: 0
    });
  }

  const records = await Payroll.findAll({
    where: { employeeId: employee.id },
    order: [["periodEnd", "DESC"]]
  });

  res.render("my-payslips", {
    title: "My Payslips | DJs HRMS",
    employee: employee.toJSON(),
    rows: records.map((r) => r.toJSON()),
    totalNet: records.reduce((sum, r) => sum + Number(r.netSalary || 0), 0)
  });
});

// Admin "Retry posting" for a paid payroll that could not reach Accounting.
export const payrollRetrySync = asyncHandler(async (req, res) => {
  const payroll = await Payroll.findByPk(req.params.id);
  if (!payroll) {
    req.flash("error_msg", "Payroll record not found.");
    return res.redirect("/payroll");
  }
  if (payroll.status !== "Paid") {
    req.flash("error_msg", "Only paid payroll is posted to Accounting.");
    return res.redirect(`/payroll/${payroll.id}`);
  }
  await payroll.update({ accountingSyncStatus: "Pending", accountingSyncAttempts: 0, accountingNextAttemptAt: null });
  const result = await postPayroll(payroll.id);
  if (result?.accountingSyncStatus === "Synced") req.flash("success_msg", `Posted to Accounting as ${result.accountingEntryNumber}.`);
  else req.flash("error_msg", `Not posted yet: ${result?.accountingSyncError || "will retry automatically"}`);
  res.redirect(`/payroll/${payroll.id}`);
});
