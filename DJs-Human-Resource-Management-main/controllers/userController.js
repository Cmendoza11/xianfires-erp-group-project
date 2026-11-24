import bcrypt from "bcrypt";
import { User, Employee, PasswordRequest } from "../models/index.js";
import { publicRequest, CLEAR_RESET } from "./passwordResetController.js";
import { notifyUsers } from "../services/notify.js";
import { asyncHandler, parseId, paginate } from "../utils/helpers.js";

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
  const { rows, pagination } = paginate(req, users.map((u) => u.toJSON()));

  // "Forgot password" requests waiting for the administrator (oldest first).
  // publicRequest adds the state badge and strips tokenHash / claimHash before they reach the view.
  const passwordRequests = (await PasswordRequest.findAll({
    where: { status: "Pending" },
    include: [{ model: User, as: "user", attributes: ["id", "name", "email", "role"] }],
    order: [["createdAt", "ASC"]]
  })).map(publicRequest).filter((r) => r.user);
  // A link made with "Send link instead" is shown once, right after it is made, and never stored.
  const resetLink = req.flash("reset_link")[0] || null;
  const resetEmail = req.flash("reset_email")[0] || null;

  res.render("users", {
    title: "User Accounts | DJs HRMS",
    users: rows,
    pagination,
    passwordRequests,
    resetLink,
    resetEmail,
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
  await notifyUsers([user.id], {
    type: "account", icon: "i-check", tone: "green",
    title: "Your account is linked to your employee record",
    detail: `${employee.employeeCode} · you can now see your attendance, leaves and payslips`,
    href: "/profile"
  });
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
  // A reset answers any "forgot password" request from this account.
  const answered = await PasswordRequest.update(
    { status: "Done", handledBy: req.user.id, handledAt: new Date(), ...CLEAR_RESET },
    { where: { userId: user.id, status: "Pending" } }
  );
  req.flash(
    "success_msg",
    `Password reset for ${user.email}.${answered[0] ? " The reset request is marked done." : ""} Give the temporary password to the user privately; they can change it in My Profile.`
  );
  res.redirect("/users");
});

// POST /password-requests/:id/dismiss: a request the admin will not act on (e.g. the identity could not be verified).
export const dismissPasswordRequest = asyncHandler(async (req, res) => {
  const request = await PasswordRequest.findByPk(parseId(req.params.id) || 0, {
    include: [{ model: User, as: "user", attributes: ["email"] }]
  });
  if (!request || request.status !== "Pending") {
    req.flash("error_msg", "That reset request is no longer pending.");
    return res.redirect("/users");
  }
  await request.update({ status: "Dismissed", handledBy: req.user.id, handledAt: new Date(), ...CLEAR_RESET });
  req.flash("success_msg", `Reset request from ${request.user?.email || "an account"} dismissed.`);
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
      req.flash("error_msg", "At least one administrator account is -.");
      return res.redirect("/users");
    }
  }

  const previousRole = user.role;
  await user.update({ role });
  if (role !== previousRole) {
    await notifyUsers([user.id], {
      type: "account", icon: "i-settings", tone: "blue",
      title: `Your role is now ${role}`,
      detail: `Changed from ${previousRole} by an administrator · some pages may look different`,
      href: "/dashboard"
    });
  }
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
      req.flash("error_msg", "At least one administrator account is -.");
      return res.redirect("/users");
    }
  }

  await user.destroy();
  req.flash("success_msg", "Account deleted.");
  res.redirect("/users");
});
