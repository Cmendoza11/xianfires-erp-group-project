import { Op } from "sequelize";
import { Payroll, Employee } from "../models/index.js";
import { asyncHandler, parseId, parseMoney, findEmployeeForUser } from "../utils/helpers.js";
import { isValidDate } from "../utils/hr.js";
import { startOfMonthISO, endOfMonthISO, localDateISO } from "../utils/format.js";
import { isLockedByAccounting, postPayroll, queuePayroll } from "../services/accountingSync.js";

const PAYROLL_STATUSES = ["Draft", "Processed", "Paid"];

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
    employees: employees.map((e) => e.toJSON()),
    defaultStart: startOfMonthISO(),
    defaultEnd: endOfMonthISO(),
    statuses: PAYROLL_STATUSES
  });
});

export const payrollCreate = asyncHandler(async (req, res) => {
  const employeeId = parseId(req.body.employeeId);
  const employee = employeeId ? await Employee.findByPk(employeeId) : null;
  const periodStart = String(req.body.periodStart || "").trim();
  const periodEnd = String(req.body.periodEnd || "").trim();
  const basicSalary = req.body.basicSalary === "" ? Number(employee?.salary || 0) : parseMoney(req.body.basicSalary);
  const allowances = parseMoney(req.body.allowances);
  const overtime = parseMoney(req.body.overtime);
  const deductions = parseMoney(req.body.deductions);
  const status = PAYROLL_STATUSES.includes(req.body.status) ? req.body.status : "Draft";

  const errors = [];
  if (!employee) errors.push("Select a valid employee.");
  if (!isValidDate(periodStart) || !isValidDate(periodEnd)) errors.push("Provide a valid payroll period.");
  if (isValidDate(periodStart) && isValidDate(periodEnd) && periodEnd < periodStart) {
    errors.push("The period end cannot be before the period start.");
  }
  if (!basicSalary || basicSalary < 0) errors.push("Basic salary must be a positive amount.");

  if (errors.length) {
    req.flash("error_msg", errors.join(" "));
    return res.redirect("/payroll/create");
  }

  const duplicate = await Payroll.findOne({ where: { employeeId, periodStart, periodEnd } });
  if (duplicate) {
    req.flash("error_msg", "Payroll already exists for this employee and period.");
    return res.redirect("/payroll");
  }

  const netSalary = basicSalary + allowances + overtime - deductions;

  const payroll = await Payroll.create({
    employeeId,
    periodStart,
    periodEnd,
    basicSalary,
    allowances,
    overtime,
    deductions,
    netSalary,
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

  res.render("payslip", {
    title: "Payslip | DJs HRMS",
    payroll: payroll.toJSON(),
    employee: payroll.employee ? payroll.employee.toJSON() : null,
    canManage: res.locals.isAdmin,
    statuses: PAYROLL_STATUSES
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
