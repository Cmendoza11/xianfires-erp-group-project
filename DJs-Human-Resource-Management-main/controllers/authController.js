import bcrypt from "bcrypt";
import { User, Employee } from "../models/index.js";
import { asyncHandler } from "../utils/helpers.js";

const cleanEmail = (value) => String(value || "").trim().toLowerCase();
const cleanText = (value) => String(value ?? "").trim();
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const startSession = (req, user) =>
  new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.role = user.role;
      resolve();
    });
  });

export const loginPage = (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.render("login", { title: "Login | DJs HRMS" });
};

export const registerPage = (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.render("register", { title: "Register | DJs HRMS" });
};

export const forgotPasswordPage = (req, res) => {
  res.render("forgotpassword", { title: "Forgot Password | DJs HRMS" });
};

export const loginUser = asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!email || !password) {
    req.flash("error_msg", "Email and password are required.");
    return res.redirect("/login");
  }

  const user = await User.findOne({ where: { email }, order: [["id", "ASC"]] });
  const valid = user ? await bcrypt.compare(password, user.password) : false;

  if (!user || !valid) {
    // Same message for both cases so account existence is not revealed.
    req.flash("error_msg", "Invalid email or password.");
    return res.redirect("/login");
  }

  const returnTo = req.session.returnTo;
  await startSession(req, user);
  req.flash("success_msg", `Welcome back, ${user.name}.`);
  res.redirect(returnTo && returnTo.startsWith("/") ? returnTo : "/dashboard");
});

export const registerUser = asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name);
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || "");
  const confirmation = String(req.body.confirmPassword || req.body.confirm || "");

  const errors = [];
  if (name.length < 2) errors.push("Please enter your full name.");
  if (!isEmail(email)) errors.push("Please enter a valid email address.");
  if (password.length < 8) errors.push("Password must be at least 8 characters long.");
  if (confirmation && confirmation !== password) errors.push("Passwords do not match.");

  const existing = email ? await User.findOne({ where: { email }, order: [["id", "ASC"]] }) : null;
  if (existing) errors.push("An account with this email already exists.");

  if (errors.length) {
    req.flash("error_msg", errors.join(" "));
    return res.redirect("/register");
  }

  // Public sign-ups are always employees; roles are elevated by an administrator.
  const employee = await Employee.findOne({ where: { email }, order: [["id", "ASC"]] });
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email,
    password: hashed,
    role: "employee",
    employeeId: employee ? employee.id : null
  });

  await startSession(req, user);
  req.flash(
    "success_msg",
    employee
      ? "Account created. Your employee record is now linked."
      : "Account created. Ask HR to link your employee record."
  );
  res.redirect("/dashboard");
});

export const updateProfile = asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name);
  const email = cleanEmail(req.body.email);

  const errors = [];
  if (name.length < 2) errors.push("Please enter your full name.");
  if (!isEmail(email)) errors.push("Please enter a valid email address.");

  // Only check uniqueness when the address actually changes, so legacy
  // duplicate accounts can still edit their other details.
  if (!errors.length && email !== req.user.email) {
    const taken = await User.findOne({ where: { email }, order: [["id", "ASC"]] });
    if (taken) errors.push("That email is already used by another account.");
  }

  if (errors.length) {
    req.flash("error_msg", errors.join(" "));
    return res.redirect("/profile");
  }

  if (name === req.user.name && email === req.user.email) {
    req.flash("success_msg", "No profile changes to save.");
    return res.redirect("/profile");
  }

  await req.user.update({ name, email });
  req.flash("success_msg", "Your profile was updated.");
  res.redirect("/profile");
});

export const changePassword = asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const confirmation = String(req.body.confirmPassword || "");

  const user = await User.findByPk(req.user.id);
  const valid = user ? await bcrypt.compare(currentPassword, user.password) : false;

  const errors = [];
  if (!valid) errors.push("Your current password is incorrect.");
  if (newPassword.length < 8) errors.push("The new password must be at least 8 characters.");
  if (confirmation && confirmation !== newPassword) errors.push("New passwords do not match.");

  if (errors.length) {
    req.flash("error_msg", errors.join(" "));
    return res.redirect("/profile");
  }

  await user.update({ password: await bcrypt.hash(newPassword, 10) });
  req.flash("success_msg", "Password updated successfully.");
  res.redirect("/profile");
});

export const logoutUser = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
};
