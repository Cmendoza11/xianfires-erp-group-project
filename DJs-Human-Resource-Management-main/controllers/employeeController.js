import { Op } from "sequelize";
import {
  Employee,
  Department,
  User,
  Attendance,
  Leave,
  Payroll
} from "../models/index.js";
import {
  asyncHandler,
  parseId,
  parseMoney,
  generateEmployeeCode,
  getDepartmentNames,
  findEmployeeForUser
} from "../utils/helpers.js";
import { EMPLOYMENT_STATUSES, isValidDate } from "../utils/hr.js";

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const readEmployeeForm = (body) => {
  const data = {
    employeeCode: String(body.employeeCode || "").trim(),
    firstName: String(body.firstName || "").trim(),
    lastName: String(body.lastName || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    phone: String(body.phone || "").trim() || null,
    department: String(body.department || "").trim(),
    position: String(body.position || "").trim(),
    salary: parseMoney(body.salary),
    dateHired: String(body.dateHired || "").trim(),
    status: EMPLOYMENT_STATUSES.includes(body.status) ? body.status : "Active"
  };

  const errors = [];
  if (!data.employeeCode) errors.push("Employee ID is required.");
  if (!data.firstName) errors.push("First name is required.");
  if (!data.lastName) errors.push("Last name is required.");
  if (!isEmail(data.email)) errors.push("A valid email address is required.");
  if (!data.department) errors.push("Department is required.");
  if (!data.position) errors.push("Position is required.");
  if (!isValidDate(data.dateHired)) errors.push("A valid date hired is required.");
  if (data.salary < 0) errors.push("Salary cannot be negative.");

  return { data, errors };
};

// Links a matching unlinked account (same email) to an employee record.
const linkAccount = async (employee) => {
  if (!employee || !employee.email) return;
  const account = await User.findOne({
    where: { email: employee.email, employeeId: null },
    order: [["id", "ASC"]]
  });
  if (account) await account.update({ employeeId: employee.id });
};

const ensureUnique = async (data, ignoreId = null) => {
  const errors = [];
  const codeWhere = { employeeCode: data.employeeCode };
  const emailWhere = { email: data.email };
  if (ignoreId) {
    codeWhere.id = { [Op.ne]: ignoreId };
    emailWhere.id = { [Op.ne]: ignoreId };
  }

  const [codeTaken, emailTaken] = await Promise.all([
    Employee.findOne({ where: codeWhere }),
    Employee.findOne({ where: emailWhere })
  ]);

  if (codeTaken) errors.push("That Employee ID is already in use.");
  if (emailTaken) errors.push("That email is already used by another employee.");
  return errors;
};

export const employeeList = asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim();
  const department = String(req.query.department || "").trim();
  const status = EMPLOYMENT_STATUSES.includes(req.query.status) ? req.query.status : "";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = 10;

  const where = {};
  if (status) where.status = status;
  if (department) where.department = department;
  if (q) {
    where[Op.or] = [
      { firstName: { [Op.like]: `%${q}%` } },
      { lastName: { [Op.like]: `%${q}%` } },
      { email: { [Op.like]: `%${q}%` } },
      { employeeCode: { [Op.like]: `%${q}%` } },
      { position: { [Op.like]: `%${q}%` } }
    ];
  }

  const { count, rows } = await Employee.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit,
    offset: (page - 1) * limit
  });

  const totalPages = Math.max(1, Math.ceil(count / limit));

  res.render("employees", {
    title: "Employees | DJs HRMS",
    employees: rows.map((row) => row.toJSON()),
    departments: await getDepartmentNames(),
    statuses: EMPLOYMENT_STATUSES,
    filters: { q, department, status },
    pagination: {
      page,
      count,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: Math.max(1, page - 1),
      nextPage: Math.min(totalPages, page + 1)
    }
  });
});

export const employeeCreatePage = asyncHandler(async (req, res) => {
  res.render("employee-create", {
    title: "Add Employee | DJs HRMS",
    departments: await getDepartmentNames(),
    statuses: EMPLOYMENT_STATUSES,
    nextCode: await generateEmployeeCode()
  });
});

export const employeeCreate = asyncHandler(async (req, res) => {
  // Generate the employee ID before validation so a blank field is accepted.
  const providedCode = String(req.body.employeeCode || "").trim();
  const { data, errors } = readEmployeeForm({
    ...req.body,
    employeeCode: providedCode || (await generateEmployeeCode())
  });

  const uniqueErrors = await ensureUnique(data);
  const allErrors = [...errors, ...uniqueErrors];

  if (allErrors.length) {
    req.flash("error_msg", allErrors.join(" "));
    return res.redirect("/employees/create");
  }

  const employee = await Employee.create(data);
  await linkAccount(employee);

  req.flash("success_msg", `Employee ${employee.firstName} ${employee.lastName} was added.`);
  res.redirect(`/employees/${employee.id}`);
});

export const employeeShow = asyncHandler(async (req, res) => {
  const employee = await Employee.findByPk(req.params.id, {
    include: [{ model: User, as: "account", attributes: ["id", "name", "email", "role"] }]
  });

  if (!employee) {
    req.flash("error_msg", "Employee not found.");
    return res.redirect(res.locals.isLimited ? "/profile" : "/employees");
  }

  let selfEmployee = null;
  if (res.locals.isLimited) {
    selfEmployee = await findEmployeeForUser(req.user);
    if (!selfEmployee || selfEmployee.id !== employee.id) {
      return res.status(403).render("403", { title: "Access Denied | DJs HRMS" });
    }
  }

  const [attendance, leaves, payrolls] = await Promise.all([
    Attendance.findAll({ where: { employeeId: employee.id }, order: [["date", "DESC"]], limit: 5 }),
    Leave.findAll({ where: { employeeId: employee.id }, order: [["createdAt", "DESC"]], limit: 5 }),
    Payroll.findAll({ where: { employeeId: employee.id }, order: [["periodEnd", "DESC"]], limit: 5 })
  ]);

  res.render("employee-show", {
    title: `${employee.firstName} ${employee.lastName} | DJs HRMS`,
    employee: employee.toJSON(),
    selfView: Boolean(selfEmployee),
    canSeePayroll: res.locals.isAdmin,
    recentAttendance: attendance.map((a) => a.toJSON()),
    recentLeaves: leaves.map((l) => l.toJSON()),
    recentPayroll: res.locals.isAdmin ? payrolls.map((p) => p.toJSON()) : []
  });
});

export const employeeEditPage = asyncHandler(async (req, res) => {
  const employee = await Employee.findByPk(req.params.id);

  if (!employee) {
    req.flash("error_msg", "Employee not found.");
    return res.redirect("/employees");
  }

  res.render("employee-edit", {
    title: "Edit Employee | DJs HRMS",
    employee: employee.toJSON(),
    departments: await getDepartmentNames(),
    statuses: EMPLOYMENT_STATUSES
  });
});

export const employeeUpdate = asyncHandler(async (req, res) => {
  const employee = await Employee.findByPk(req.params.id);

  if (!employee) {
    req.flash("error_msg", "Employee not found.");
    return res.redirect("/employees");
  }

  const { data, errors } = readEmployeeForm(req.body);
  const uniqueErrors = await ensureUnique(data, employee.id);
  const allErrors = [...errors, ...uniqueErrors];

  if (allErrors.length) {
    req.flash("error_msg", allErrors.join(" "));
    return res.redirect(`/employees/${employee.id}/edit`);
  }

  await employee.update(data);
  await linkAccount(employee);

  req.flash("success_msg", "Employee record updated.");
  res.redirect(`/employees/${employee.id}`);
});

export const employeeDelete = asyncHandler(async (req, res) => {
  const employee = await Employee.findByPk(req.params.id);

  if (!employee) {
    req.flash("error_msg", "Employee not found.");
    return res.redirect("/employees");
  }

  const name = `${employee.firstName} ${employee.lastName}`;
  await employee.destroy();

  req.flash("success_msg", `${name} and their HR records were deleted.`);
  res.redirect("/employees");
});

export const employeeProfile = asyncHandler(async (req, res) => {
  const employee = await findEmployeeForUser(req.user);

  res.render("profile", {
    title: "My Profile | DJs HRMS",
    employee: employee ? employee.toJSON() : null
  });
});
