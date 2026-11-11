import { Op } from "sequelize";
import { Leave, Employee } from "../models/index.js";
import { asyncHandler, parseId, findEmployeeForUser } from "../utils/helpers.js";
import {
  LEAVE_TYPES,
  LEAVE_ALLOCATION,
  leaveDays,
  isValidDate
} from "../utils/hr.js";

const currentYearRange = () => {
  const year = new Date().getFullYear();
  return [`${year}-01-01`, `${year}-12-31`];
};

export const computeBalances = async (employeeId) => {
  const [start, end] = currentYearRange();
  const approved = await Leave.findAll({
    where: {
      employeeId,
      status: "Approved",
      startDate: { [Op.lte]: end },
      endDate: { [Op.gte]: start }
    }
  });

  return LEAVE_TYPES.map((type) => {
    const used = approved
      .filter((leave) => leave.type === type)
      .reduce((sum, leave) => {
        const from = leave.startDate > start ? leave.startDate : start;
        const to = leave.endDate < end ? leave.endDate : end;
        return sum + leaveDays(from, to);
      }, 0);

    const allocation = LEAVE_ALLOCATION[type] ?? 0;
    return { type, allocation, used, remaining: Math.max(0, allocation - used) };
  });
};

const employeeName = (employee) =>
  employee ? `${employee.firstName} ${employee.lastName}` : "—";

export const leaveList = asyncHandler(async (req, res) => {
  const status = ["Pending", "Approved", "Rejected"].includes(req.query.status)
    ? req.query.status
    : "";
  const type = LEAVE_TYPES.includes(req.query.type) ? req.query.type : "";

  const where = {};
  if (status) where.status = status;
  if (type) where.type = type;

  let employee = null;
  let balances = null;

  if (res.locals.isLimited) {
    employee = await findEmployeeForUser(req.user);
    if (!employee) {
      return res.render("leaves", {
        title: "Leave Management | DJs HRMS",
        leaves: [],
        balances: null,
        employee: null,
        types: LEAVE_TYPES,
        filters: { status, type },
        selfView: true,
        summary: null
      });
    }
    where.employeeId = employee.id;
    balances = await computeBalances(employee.id);
  } else if (parseId(req.query.employeeId)) {
    employee = await Employee.findByPk(req.query.employeeId);
    if (employee) {
      where.employeeId = employee.id;
      balances = await computeBalances(employee.id);
    }
  }

  const leaves = await Leave.findAll({
    where,
    include: [
      { model: Employee, as: "employee", attributes: ["id", "firstName", "lastName", "employeeCode"] }
    ],
    order: [["createdAt", "DESC"]]
  });

  const summary = {
    pending: leaves.filter((l) => l.status === "Pending").length,
    approved: leaves.filter((l) => l.status === "Approved").length,
    rejected: leaves.filter((l) => l.status === "Rejected").length
  };

  res.render("leaves", {
    title: "Leave Management | DJs HRMS",
    leaves: leaves.map((l) => l.toJSON()),
    balances,
    employee: employee ? employee.toJSON() : null,
    types: LEAVE_TYPES,
    filters: { status, type },
    selfView: res.locals.isLimited,
    summary,
    employees: res.locals.isLimited
      ? []
      : (await Employee.findAll({ order: [["lastName", "ASC"]] })).map((e) => e.toJSON())
  });
});

export const leaveCreatePage = asyncHandler(async (req, res) => {
  const selfEmployee = res.locals.isLimited ? await findEmployeeForUser(req.user) : null;

  res.render("leave-create", {
    title: "File Leave | DJs HRMS",
    types: LEAVE_TYPES,
    selfView: res.locals.isLimited,
    employee: selfEmployee ? selfEmployee.toJSON() : null,
    employees: res.locals.isLimited
      ? []
      : (await Employee.findAll({ order: [["lastName", "ASC"]] })).map((e) => e.toJSON())
  });
});

export const leaveCreate = asyncHandler(async (req, res) => {
  const type = LEAVE_TYPES.includes(req.body.type) ? req.body.type : null;
  const startDate = String(req.body.startDate || "").trim();
  const endDate = String(req.body.endDate || "").trim();
  const reason = String(req.body.reason || "").trim();

  let employeeId;
  if (res.locals.isLimited) {
    const employee = await findEmployeeForUser(req.user);
    employeeId = employee ? employee.id : null;
  } else {
    employeeId = parseId(req.body.employeeId);
  }

  const errors = [];
  if (!employeeId) errors.push("Select the employee filing the leave.");
  if (!type) errors.push("Select a valid leave type.");
  if (!isValidDate(startDate) || !isValidDate(endDate)) errors.push("Provide valid leave dates.");
  if (isValidDate(startDate) && isValidDate(endDate) && endDate < startDate) {
    errors.push("The end date cannot be before the start date.");
  }
  if (reason.length < 5) errors.push("Please provide a reason (at least 5 characters).");

  if (errors.length) {
    req.flash("error_msg", errors.join(" "));
    return res.redirect("/leaves/create");
  }

  const overlap = await Leave.findOne({
    where: {
      employeeId,
      status: { [Op.in]: ["Pending", "Approved"] },
      startDate: { [Op.lte]: endDate },
      endDate: { [Op.gte]: startDate }
    }
  });

  if (overlap) {
    req.flash("error_msg", "This employee already has a pending or approved leave for those dates.");
    return res.redirect("/leaves/create");
  }

  const days = leaveDays(startDate, endDate);

  await Leave.create({
    employeeId,
    type,
    startDate,
    endDate,
    days,
    reason,
    status: "Pending"
  });

  req.flash("success_msg", `Leave request submitted for ${days} day(s).`);
  res.redirect("/leaves");
});

export const leaveApprove = asyncHandler(async (req, res) => {
  const leave = await Leave.findByPk(req.params.id, {
    include: [{ model: Employee, as: "employee" }]
  });

  if (!leave) {
    req.flash("error_msg", "Leave request not found.");
    return res.redirect("/leaves");
  }

  if (leave.status !== "Pending") {
    req.flash("error_msg", "Only pending requests can be approved.");
    return res.redirect("/leaves");
  }

  await leave.update({
    status: "Approved",
    reviewedBy: req.user.id,
    reviewedAt: new Date(),
    remarks: String(req.body.remarks || "").trim() || leave.remarks
  });

  req.flash("success_msg", `Approved ${employeeName(leave.employee)}'s ${leave.type} leave.`);
  res.redirect("/leaves");
});

export const leaveReject = asyncHandler(async (req, res) => {
  const leave = await Leave.findByPk(req.params.id, {
    include: [{ model: Employee, as: "employee" }]
  });

  if (!leave) {
    req.flash("error_msg", "Leave request not found.");
    return res.redirect("/leaves");
  }

  if (leave.status !== "Pending") {
    req.flash("error_msg", "Only pending requests can be rejected.");
    return res.redirect("/leaves");
  }

  await leave.update({
    status: "Rejected",
    reviewedBy: req.user.id,
    reviewedAt: new Date(),
    remarks: String(req.body.remarks || "").trim() || null
  });

  req.flash("success_msg", `Rejected ${employeeName(leave.employee)}'s ${leave.type} leave.`);
  res.redirect("/leaves");
});

export const leaveDelete = asyncHandler(async (req, res) => {
  const leave = await Leave.findByPk(req.params.id);

  if (!leave) {
    req.flash("error_msg", "Leave request not found.");
    return res.redirect("/leaves");
  }

  if (res.locals.isLimited) {
    const employee = await findEmployeeForUser(req.user);
    if (!employee || leave.employeeId !== employee.id) {
      return res.status(403).render("403", { title: "Access Denied | DJs HRMS" });
    }
    if (leave.status !== "Pending") {
      req.flash("error_msg", "Only pending requests can be cancelled.");
      return res.redirect("/leaves");
    }
  }

  await leave.destroy();
  req.flash("success_msg", "Leave request removed.");
  res.redirect("/leaves");
});
