import bcrypt from "bcrypt";
import { User, Employee } from "../models/index.js";
import { asyncHandler, parseId } from "../utils/helpers.js";

const ROLES = ["admin", "staff", "employee"];
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const userList = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    include: [{ model: Employee, as: "employee", attributes: ["id", "firstName", "lastName", "employeeCode"] }],
    order: [["id", "ASC"]]
  });

  const employees = await Employee.findAll({
    attributes: ["id", "firstName", "lastName", "employeeCode"],
    order: [["lastName", "ASC"]]
  });
  const linked = new Set(users.map((u) => u.employeeId).filter(Boolean));

  res.render("users", {
    title: "User Accounts | DJs HRMS",
    users: users.map((u) => u.toJSON()),
    roles: ROLES,
    // Employees without an account yet, for the "Link to employee" control.
    freeEmployees: employees.filter((e) => !linked.has(e.id)).map((e) => e.toJSON())
  });
});

// POST /users/:id/employee  employeeId=<id> links, employeeId="" unlinks. Only an admin links accounts.
export const linkUserEmployee = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) {
    req.flash("error_msg", "Account not found.");
    return res.redirect("/users");
  }

  const employeeId = parseId(req.body.employeeId);
  if (!employeeId) {
    await user.update({ employeeId: null });
    req.flash("success_msg", `${user.name}'s account is no longer linked to an employee record.`);
    return res.redirect("/users");
  }

  const employee = await Employee.findByPk(employeeId);
  if (!employee) {
    req.flash("error_msg", "Employee not found.");
    return res.redirect("/users");
  }
  const other = await User.findOne({ where: { employeeId } });
  if (other && other.id !== user.id) {
    req.flash("error_msg", `${employee.firstName} ${employee.lastName} is already linked to ${other.email}.`);
    return res.redirect("/users");
  }

  await user.update({ employeeId });
  req.flash("success_msg", `${user.email} is now linked to ${employee.employeeCode} ${employee.firstName} ${employee.lastName}.`);
  res.redirect("/users");
});

export const createUser = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const role = ROLES.includes(req.body.role) ? req.body.role : "employee";
  const password = String(req.body.password || "");

  const errors = [];
  if (name.length < 2) errors.push("Enter the account holder's full name.");
  if (!isEmail(email)) errors.push("Enter a valid email address.");
  if (password.length < 8) errors.push("The temporary password must be at least 8 characters.");

  if (email && (await User.findOne({ where: { email }, order: [["id", "ASC"]] }))) {
    errors.push("An account with this email already exists.");
  }

  if (errors.length) {
    req.flash("error_msg", errors.join(" "));
    return res.redirect("/users");
  }

  // The admin is creating this account, so a matching employee email is trusted here,
  // as long as that employee has no account yet.
  const match = await Employee.findOne({ where: { email }, order: [["id", "ASC"]] });
  const employee = match && !(await User.findOne({ where: { employeeId: match.id } })) ? match : null;

  await User.create({
    name,
    email,
    role,
    password: await bcrypt.hash(password, 10),
    employeeId: employee ? employee.id : null
  });

  req.flash(
    "success_msg",
    `Account created for ${email}. Share the temporary password securely; the user can change it from My Profile.`
  );
  res.redirect("/users");
});

export const resetUserPassword = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  const password = String(req.body.newPassword || "");

  if (!user) {
    req.flash("error_msg", "Account not found.");
    return res.redirect("/users");
  }

  if (password.length < 8) {
    req.flash("error_msg", "The new password must be at least 8 characters.");
    return res.redirect("/users");
  }

  await user.update({ password: await bcrypt.hash(password, 10) });
  req.flash("success_msg", `Password reset for ${user.email}.`);
  res.redirect("/users");
});

export const updateUserRole = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  const role = ROLES.includes(req.body.role) ? req.body.role : null;

  if (!user) {
    req.flash("error_msg", "Account not found.");
    return res.redirect("/users");
  }

  if (!role) {
    req.flash("error_msg", "Invalid role selected.");
    return res.redirect("/users");
  }

  if (user.id === req.user.id && role !== "admin") {
    req.flash("error_msg", "You cannot remove your own administrator access.");
    return res.redirect("/users");
  }

  if (user.role === "admin" && role !== "admin") {
    const admins = await User.count({ where: { role: "admin" } });
    if (admins <= 1) {
      req.flash("error_msg", "At least one administrator account is required.");
      return res.redirect("/users");
    }
  }

  await user.update({ role });
  req.flash("success_msg", `${user.name}'s role is now ${role}.`);
  res.redirect("/users");
});

export const deleteUser = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const user = id ? await User.findByPk(id) : null;

  if (!user) {
    req.flash("error_msg", "Account not found.");
    return res.redirect("/users");
  }

  if (user.id === req.user.id) {
    req.flash("error_msg", "You cannot delete your own account.");
    return res.redirect("/users");
  }

  if (user.role === "admin") {
    const admins = await User.count({ where: { role: "admin" } });
    if (admins <= 1) {
      req.flash("error_msg", "At least one administrator account is required.");
      return res.redirect("/users");
    }
  }

  await user.destroy();
  req.flash("success_msg", "Account deleted.");
  res.redirect("/users");
});
