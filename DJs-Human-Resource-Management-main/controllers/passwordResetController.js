/*
  Forgot password with HR approval (no mail server needed).

  1. POST /forgot-password      the user sends email + name. The account's Pending request gets a new
                                 browser secret: only its SHA-256 (claimHash) is stored, the secret itself
                                 goes into an httpOnly cookie (not the session: the memory session store is
                                 lost whenever the server restarts). Unknown emails get the same waiting page.
  2. GET  /forgot-password/status  the waiting page asks every 3 s. When the admin has approved, this
                                 browser (and only this one, it must hold the secret) receives a one-time
                                 /reset-password/<token> link and goes there by itself.
  3. POST /password-requests/:id/approve   admin approves (valid 30 minutes).
     POST /password-requests/:id/link      admin makes a link to hand over (user closed the waiting page).
  4. GET/POST /reset-password/:token       set a new password; the link works once, for 30 minutes.
  Only hashes are stored (tokenHash, claimHash); a secret or link is never saved in the database.
*/
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { sequelize, User, PasswordRequest } from "../models/index.js";
import { asyncHandler, parseId } from "../utils/helpers.js";

export const RESET_MINUTES = 30;
const TTL_MS = RESET_MINUTES * 60 * 1000;
const COOKIE = "hr_pw_reset";

export const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const newSecret = () => crypto.randomBytes(32).toString("hex");
const cleanEmail = (value) => String(value || "").trim().toLowerCase();
const cleanText = (value) => String(value ?? "").trim();
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const timeOf = (date) => new Date(date).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

// ---- the waiting browser's cookie: { id, claim, email, until } as base64url JSON ----
function readResetCookie(req) {
  const raw = String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  try {
    const data = JSON.parse(Buffer.from(decodeURIComponent(raw.slice(COOKIE.length + 1)), "base64url").toString("utf8"));
    if (!data || typeof data.claim !== "string" || !(Number(data.until) > Date.now())) return null;
    return { id: Number(data.id) || 0, claim: data.claim, email: String(data.email || ""), until: Number(data.until) };
  } catch {
    return null;
  }
}

function setResetCookie(res, data) {
  res.cookie(COOKIE, Buffer.from(JSON.stringify(data)).toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_MS
  });
}

const clearResetCookie = (res) => res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax" });

/** Where a Pending request stands, for the admin's badges (never exposes hashes). */
export function requestState(r, now = new Date()) {
  const live = r.expiresAt && new Date(r.expiresAt) > now;
  if (r.tokenHash) return live ? { state: "link", label: `Link given · until ${timeOf(r.expiresAt)}` } : { state: "expired", label: "Expired" };
  if (r.approvedAt) return live ? { state: "approved", label: `Approved · until ${timeOf(r.expiresAt)}` } : { state: "expired", label: "Expired" };
  if (r.claimHash) return { state: "waiting", label: "Waiting for approval", canApprove: true };
  return { state: "closed", label: "Waiting page closed" };
}

/** A request as the views may see it: no tokenHash / claimHash. */
export function publicRequest(r) {
  const plain = typeof r.toJSON === "function" ? r.toJSON() : { ...r };
  const view = { ...plain, ...requestState(plain) };
  delete view.tokenHash;
  delete view.claimHash;
  return view;
}

/** Stops any approval or link of a request (used when the admin resets the password or dismisses). */
export const CLEAR_RESET = { tokenHash: null, expiresAt: null, approvedAt: null };

// ---------------------------------------------------------------- user side
export const forgotPasswordPage = (req, res) => {
  if (req.session.userId) return res.redirect("/profile#password");
  const waiting = readResetCookie(req);
  res.render("forgotpassword", {
    title: "Forgot Password | DJs HRMS",
    waiting: waiting ? { email: waiting.email, until: timeOf(waiting.until) } : null
  });
};

export const forgotPasswordSubmit = asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body.email);
  const name = cleanText(req.body.name).slice(0, 120);
  const note = cleanText(req.body.note).slice(0, 255) || null;

  const errors = [];
  if (!isEmail(email)) errors.push("Enter the email address you use to sign in.");
  if (name.length < 2) errors.push("Enter your full name so HR can verify your identity.");
  if (errors.length) {
    req.flash("error_msg", errors.join(" "));
    return res.redirect("/forgot-password");
  }

  const claim = newSecret();
  let id = 0; // unknown email: same waiting page, it is simply never approved
  const user = await User.findOne({ where: { email }, order: [["id", "ASC"]] });
  if (user) {
    const fresh = { name, note, claimHash: sha256(claim), ...CLEAR_RESET };
    let request = await PasswordRequest.findOne({ where: { userId: user.id, status: "Pending" } });
    if (request) await request.update(fresh); // one pending request per account; a new send restarts it
    else request = await PasswordRequest.create({ userId: user.id, ...fresh });
    id = request.id;
  }

  setResetCookie(res, { id, claim, email, until: Date.now() + TTL_MS });
  res.redirect("/forgot-password");
});

// GET /forgot-password/status (JSON) — polled by the waiting page.
export const forgotPasswordStatus = asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const waiting = readResetCookie(req);
  if (!waiting) return res.json({ status: "expired" });
  if (!waiting.id) return res.json({ status: "pending" });

  const request = await PasswordRequest.findByPk(waiting.id);
  if (!request) {
    clearResetCookie(res);
    return res.json({ status: "dismissed" });
  }
  // Only the browser that holds this request's secret may receive an approval.
  if (request.claimHash && request.claimHash !== sha256(waiting.claim)) {
    clearResetCookie(res); // a newer request (e.g. from another browser) replaced this one
    return res.json({ status: "expired" });
  }
  if (request.status === "Dismissed") {
    clearResetCookie(res);
    return res.json({ status: "dismissed" });
  }
  if (request.status === "Done") {
    clearResetCookie(res);
    return res.json({ status: "done" });
  }
  if (!request.claimHash) {
    // The admin chose "Send link instead" (this page no longer gets the approval).
    clearResetCookie(res);
    return res.json({ status: request.tokenHash ? "link" : "expired" });
  }

  const now = new Date();
  if (request.approvedAt && request.expiresAt && new Date(request.expiresAt) > now) {
    const token = newSecret();
    await request.update({ tokenHash: sha256(token), claimHash: null }); // the approval is used up here
    clearResetCookie(res);
    return res.json({ status: "approved", url: `/reset-password/${token}` });
  }
  if (request.approvedAt) return res.json({ status: "expired" });
  res.json({ status: "pending" });
});

// POST /forgot-password/cancel — the user gives up waiting on this browser.
export const forgotPasswordCancel = asyncHandler(async (req, res) => {
  const waiting = readResetCookie(req);
  if (waiting?.id) {
    await PasswordRequest.update({ claimHash: null }, { where: { id: waiting.id, claimHash: sha256(waiting.claim), status: "Pending" } });
  }
  clearResetCookie(res);
  res.redirect("/forgot-password");
});

// ---------------------------------------------------------------- admin side
async function pendingRequest(req, res) {
  const request = await PasswordRequest.findByPk(parseId(req.params.id) || 0, {
    include: [{ model: User, as: "user", attributes: ["id", "email", "name"] }]
  });
  if (!request || !request.user || request.status !== "Pending") {
    req.flash("error_msg", "That reset request is no longer pending.");
    res.redirect("/users#password-requests");
    return null;
  }
  return request;
}

// POST /password-requests/:id/approve
export const approvePasswordRequest = asyncHandler(async (req, res) => {
  const request = await pendingRequest(req, res);
  if (!request) return;
  if (!request.claimHash) {
    req.flash("error_msg", `${request.user.email} is no longer waiting on the reset page. Use "Send link instead" or set a temporary password.`);
    return res.redirect("/users#password-requests");
  }
  const now = new Date();
  await request.update({
    approvedAt: now,
    expiresAt: new Date(now.getTime() + TTL_MS),
    tokenHash: null,
    handledBy: req.user.id
  });
  req.flash("success_msg", `Approved. ${request.user.email} is now taken to Set a new password on their screen.`);
  res.redirect("/users#password-requests");
});

// POST /password-requests/:id/link — a one-time link the admin hands over (shown once, never stored).
export const issueResetLink = asyncHandler(async (req, res) => {
  const request = await pendingRequest(req, res);
  if (!request) return;
  const token = newSecret();
  await request.update({
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + TTL_MS),
    approvedAt: null,
    claimHash: null,
    handledBy: req.user.id
  });
  req.flash("reset_link", `${req.protocol}://${req.get("host")}/reset-password/${token}`);
  req.flash("reset_email", request.user.email);
  req.flash("success_msg", `Reset link made for ${request.user.email}. It works once, for ${RESET_MINUTES} minutes.`);
  res.redirect("/users#password-requests");
});

// ---------------------------------------------------------------- set a new password
async function requestForToken(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ""))) return null;
  const request = await PasswordRequest.findOne({
    where: { tokenHash: sha256(token), status: "Pending" },
    include: [{ model: User, as: "user", attributes: ["id", "email", "name"] }]
  });
  if (!request || !request.user || !request.expiresAt || new Date(request.expiresAt) <= new Date()) return null;
  return request;
}

export const resetPasswordPage = asyncHandler(async (req, res) => {
  const request = await requestForToken(req.params.token);
  res.render("reset-password", {
    title: "Set a New Password | DJs HRMS",
    valid: !!request,
    token: request ? req.params.token : null,
    account: request ? { email: request.user.email, until: timeOf(request.expiresAt) } : null
  });
});

export const resetPasswordSubmit = asyncHandler(async (req, res) => {
  const token = req.params.token;
  const request = await requestForToken(token);
  if (!request) return res.redirect(`/reset-password/${encodeURIComponent(String(token || "x"))}`);

  const password = String(req.body.password || "");
  const confirmation = String(req.body.confirmPassword || "");
  const errors = [];
  if (password.length < 8) errors.push("The new password must be at least 8 characters.");
  if (password !== confirmation) errors.push("The passwords do not match.");
  if (errors.length) {
    req.flash("error_msg", errors.join(" "));
    return res.redirect(`/reset-password/${token}`);
  }

  const hash = await bcrypt.hash(password, 10);
  await sequelize.transaction(async (transaction) => {
    await User.update({ password: hash }, { where: { id: request.userId }, transaction });
    await request.update(
      { status: "Done", handledAt: new Date(), tokenHash: null, claimHash: null, expiresAt: null },
      { transaction }
    );
  });
  req.flash("success_msg", "Your password was changed. Sign in with your new password.");
  res.redirect("/login");
});
