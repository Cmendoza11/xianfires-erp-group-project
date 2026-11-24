import bcrypt from "bcryptjs";
import { AdminUser } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { logAudit } from "../services/auditService.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { createUser, MIN_PASSWORD_LENGTH } from "../services/userService.js";
import { clearLoginFailures, loginLockStatus, recordLoginFailure } from "../services/securityService.js";

const INVALID_LOGIN = "Invalid email or password";

// Self sign-up creates administrators, so it stays off unless ALLOW_SIGNUP=true is set in .env.
const signupEnabled = () => process.env.ALLOW_SIGNUP === "true";

// A fresh session id on login prevents session fixation.
function startSession(req, res, userId, failMessage) {
  req.session.regenerate((err) => {
    if (err) {
      console.error("❌ Session regenerate failed:", err);
      return res.status(500).json({ error: { status: 500, message: failMessage } });
    }
    req.session.userID = userId;
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error("❌ Session save failed:", saveErr);
        return res.status(500).json({ error: { status: 500, message: failMessage } });
      }
      res.json({ data: {} });
    });
  });
}

export const loginPage = (req, res) => {
  if (req.adminUser) return res.redirect(urls.dashboard);
  res.render("login", { title: "Admin Login", urls, signupEnabled: signupEnabled(), expired: req.query.expired === "1" });
};

const lockedResponse = (res, retryAfter) => {
  res.setHeader("Retry-After", String(retryAfter));
  return res.status(429).json({
    error: { status: 429, message: `Too many failed attempts. Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`, retryAfter }
  });
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: { status: 400, message: INVALID_LOGIN } });
  }
  if (email.length > 254 || password.length > 200) {
    return res.status(400).json({ error: { status: 400, message: INVALID_LOGIN } });
  }
  // Locked emails or addresses are refused before the password is even checked.
  const lock = loginLockStatus(email, req.ip);
  if (lock.locked) return lockedResponse(res, lock.retryAfter);
  // MySQL's default collation compares case-insensitively, matching the old ILIKE email lookup.
  const user = await AdminUser.findOne({ where: { email: email.trim(), status: true } });
  const match = await bcrypt.compare(password, user ? user.password : "");
  if (!user || !match) {
    const failure = await recordLoginFailure(email, req.ip);
    await logAudit(req, {
      action: failure.locked ? "auth.locked" : "auth.login_failed",
      summary: failure.locked
        ? `Login locked for ${failure.retryAfter} seconds after too many failed attempts for ${email.trim()}`
        : `Failed login attempt for ${email.trim()} (${failure.attemptsLeft} left)`,
      user: { admin_user_id: user?.admin_user_id ?? null, email: email.trim() }
    });
    if (failure.locked) return lockedResponse(res, failure.retryAfter);
    return res.status(401).json({
      error: { status: 401, message: `${INVALID_LOGIN}. ${failure.attemptsLeft} attempt${failure.attemptsLeft === 1 ? "" : "s"} left.`, attemptsLeft: failure.attemptsLeft }
    });
  }
  clearLoginFailures(email);
  await logAudit(req, {
    action: "auth.login",
    summary: `${user.full_name || user.email} logged in`,
    user: { admin_user_id: user.admin_user_id, email: user.email }
  });
  startSession(req, res, user.admin_user_id, "Unable to log in");
};

export const signupPage = (req, res, next) => {
  if (!signupEnabled()) return next();
  if (req.adminUser) return res.redirect(urls.dashboard);
  res.render("signup", { title: "Create account", urls, minPasswordLength: MIN_PASSWORD_LENGTH });
};

export const signupUser = async (req, res) => {
  if (!signupEnabled()) {
    return res.status(404).json({ error: { status: 404, message: "Sign-up is disabled" } });
  }
  const body = req.body ?? {};
  let user;
  try {
    if (body.password !== body.confirm_password) {
      throw new AccountingValidationError("Passwords do not match");
    }
    // Only the very first account may make itself an admin; anyone else who signs up can only read,
    // until an admin raises the role in Users. Otherwise anyone on the Wi-Fi could create an admin.
    const hasUsers = (await AdminUser.count({ paranoid: false })) > 0;
    user = await createUser({
      full_name: body.full_name,
      email: body.email,
      password: body.password,
      role: hasUsers ? "viewer" : "admin"
    });
  } catch (e) {
    if (e instanceof AccountingValidationError) {
      return res.status(400).json({ error: { status: 400, message: e.message } });
    }
    throw e;
  }
  const row = await AdminUser.findOne({ where: { uuid: user.uuid } });
  await logAudit(req, {
    action: "auth.signup",
    entityType: "user",
    entityId: user.uuid,
    summary: `${user.fullName || user.email} signed up`,
    user: { admin_user_id: row.admin_user_id, email: row.email }
  });
  startSession(req, res, row.admin_user_id, "Account created, but unable to log in");
};

export const logoutUser = async (req, res) => {
  if (req.adminUser) {
    await logAudit(req, {
      action: "auth.logout",
      summary: `${req.adminUser.full_name || req.adminUser.email} logged out`
    });
  }
  req.session.destroy((err) => {
    if (err) {
      console.error("❌ Session destroy failed:", err);
      return res.status(500).json({ error: { status: 500, message: "Logout failed" } });
    }
    res.clearCookie("connect.sid");
    res.json({ data: {} });
  });
};
