// Security rules shared by the login, users, settings and uploads: password policy, input formats,
// login lockout, request rate limiting and file checks.
import { AccountingValidationError } from "./accountTypes.js";
import { getSetting } from "./settingService.js";

// ---------------------------------------------------------------- settings (Administration > Settings)
export const SECURITY_DEFAULTS = { maxAttempts: 3, lockoutMinutes: 1, sessionMinutes: 30 };
export const SECURITY_LIMITS = {
  maxAttempts: { min: 1, max: 10 },
  lockoutMinutes: { min: 1, max: 60 },
  sessionMinutes: { min: 5, max: 480 }
};
export const SECURITY_KEYS = {
  maxAttempts: "securityLoginMaxAttempts",
  lockoutMinutes: "securityLockoutMinutes",
  sessionMinutes: "securitySessionMinutes"
};

const clampInt = (value, { min, max }, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export async function getSecuritySettings() {
  const out = {};
  for (const [key, setting] of Object.entries(SECURITY_KEYS)) {
    out[key] = clampInt(await getSetting(setting, SECURITY_DEFAULTS[key]), SECURITY_LIMITS[key], SECURITY_DEFAULTS[key]);
  }
  return out;
}

// Returns an error message for a bad security setting in a settings payload, or null.
export function validateSecurityPayload(body) {
  const labels = { maxAttempts: "Login attempts", lockoutMinutes: "Lockout minutes", sessionMinutes: "Session timeout" };
  for (const [key, setting] of Object.entries(SECURITY_KEYS)) {
    if (!(setting in body)) continue;
    const { min, max } = SECURITY_LIMITS[key];
    const n = Number(body[setting]);
    if (!Number.isInteger(n) || n < min || n > max) return `${labels[key]} must be a whole number from ${min} to ${max}`;
  }
  return null;
}

// ---------------------------------------------------------------- password policy
export const PASSWORD_RULES = [
  { test: (p) => p.length >= 8, label: "At least 8 characters" },
  { test: (p) => /[A-Z]/.test(p), label: "An uppercase letter (A-Z)" },
  { test: (p) => /[a-z]/.test(p), label: "A lowercase letter (a-z)" },
  { test: (p) => /\d/.test(p), label: "A number (0-9)" },
  { test: (p) => /[^A-Za-z0-9\s]/.test(p), label: "A symbol (e.g. ! @ # $ %)" },
  { test: (p) => !/\s/.test(p), label: "No spaces" }
];
export const MAX_PASSWORD_LENGTH = 72; // bcrypt ignores anything longer

export function assertStrongPassword(password, email = "") {
  if (typeof password !== "string" || !password) throw new AccountingValidationError("Password is required");
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AccountingValidationError(`Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`);
  }
  const missing = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label.charAt(0).toLowerCase() + r.label.slice(1));
  if (missing.length) throw new AccountingValidationError(`Password needs: ${missing.join(", ")}`);
  const name = String(email).split("@")[0].toLowerCase();
  if (name.length >= 3 && password.toLowerCase().includes(name)) {
    throw new AccountingValidationError("Password must not contain your email name");
  }
}

// ---------------------------------------------------------------- input formats
export const FORMATS = {
  email: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
  personName: /^[A-Za-zÀ-ÖØ-öø-ÿÑñ][A-Za-zÀ-ÖØ-öø-ÿÑñ .'-]{1,99}$/,
  tin: /^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/,
  phone: /^\+?[0-9][0-9()\- ]{6,19}$/,
  accountCode: /^\d{3,10}$/
};
// Letters, digits, spaces and common punctuation; no < > or control characters.
const SAFE_TEXT = /^[^<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;

export function assertFormat(value, pattern, message) {
  if (!pattern.test(String(value ?? ""))) throw new AccountingValidationError(message);
}

export function assertSafeText(value, label) {
  if (!SAFE_TEXT.test(String(value ?? ""))) {
    throw new AccountingValidationError(`${label} must not contain < > or control characters`);
  }
}

// ---------------------------------------------------------------- login lockout
// Failed logins are counted per email and per IP. After the limit, that email (or IP) waits for the
// lockout time. Kept in memory: a restart clears it, like the login sessions.
const failures = new Map(); // key -> { count, lockedUntil }
const IP_FACTOR = 3; // an IP may try a few different emails before it is locked too

const ipKey = (ip) => `ip:${ip}`;
const emailKey = (email) => `email:${String(email).trim().toLowerCase()}`;

function secondsLeft(entry, now) {
  return entry && entry.lockedUntil > now ? Math.ceil((entry.lockedUntil - now) / 1000) : 0;
}

export function loginLockStatus(email, ip, now = Date.now()) {
  const wait = Math.max(secondsLeft(failures.get(emailKey(email)), now), secondsLeft(failures.get(ipKey(ip)), now));
  return { locked: wait > 0, retryAfter: wait };
}

export async function recordLoginFailure(email, ip, now = Date.now()) {
  const { maxAttempts, lockoutMinutes } = await getSecuritySettings();
  const bump = (key, limit) => {
    const entry = failures.get(key);
    const fresh = !entry || (entry.lockedUntil && entry.lockedUntil <= now);
    const next = fresh ? { count: 1, lockedUntil: 0 } : { ...entry, count: entry.count + 1 };
    if (next.count >= limit) next.lockedUntil = now + lockoutMinutes * 60_000;
    failures.set(key, next);
    return next;
  };
  const byEmail = bump(emailKey(email), maxAttempts);
  bump(ipKey(ip), maxAttempts * IP_FACTOR);
  const status = loginLockStatus(email, ip, now);
  return { ...status, attemptsLeft: Math.max(0, maxAttempts - byEmail.count), justLocked: byEmail.lockedUntil > now && byEmail.count === maxAttempts };
}

export function clearLoginFailures(email) {
  failures.delete(emailKey(email));
}

// ---------------------------------------------------------------- request rate limiting
// Fixed one-minute windows per client and route group.
const windows = new Map();
export function rateLimit({ name, limit, windowMs = 60_000 }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip}`;
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      windows.set(key, w);
    }
    w.count += 1;
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - w.count)));
    if (w.count > limit) {
      const retryAfter = Math.ceil((w.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: { status: 429, message: `Too many requests. Try again in ${retryAfter} seconds.`, retryAfter } });
    }
    next();
  };
}
// Drops expired counters so the maps do not grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  for (const [key, f] of failures) if (f.lockedUntil && f.lockedUntil <= now - 3_600_000) failures.delete(key);
}, 60_000).unref();

// ---------------------------------------------------------------- security headers
export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.removeHeader("X-Powered-By");
  next();
}

// ---------------------------------------------------------------- uploads
// Only these types are accepted, recognised by their first bytes ("magic numbers"), never by name alone.
export const UPLOAD_TYPES = [
  { ext: ["jpg", "jpeg"], mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { ext: ["png"], mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: ["pdf"], mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }
];
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
// Extensions that a web server may run as code. Any of them anywhere in the name is refused
// (shell.php.jpg, shell.jpg.php, shell.phtml ...).
const DANGEROUS_EXT = /\.(php\d?|phtml|phar|pht|phps|pgif|inc|hta|htaccess|asp|aspx|ashx|asmx|cer|jsp|jspx|cgi|pl|py|rb|sh|bash|bat|cmd|com|exe|dll|msi|ps1|vbs|js|mjs|html?|xhtml|shtml|svg|xml|swf)(\.|$)/i;
// Script code that must never appear inside an accepted file (stops image/PDF "polyglot" shells).
// Patterns are long enough that random image bytes do not match them by chance.
const SCRIPT_MARKERS = [
  /<\?php/, /<\?=\s*\$[a-z_]/, /<script[\s>]/, /<%[=@]?\s*(eval|execute|response|request)/,
  /\beval\s*\(/, /base64_decode\s*\(/, /shell_exec\s*\(/, /passthru\s*\(/, /\bsystem\s*\(\s*\$/, /\bexec\s*\(\s*\$/
];

export function validateUpload({ name, data }) {
  const original = String(name ?? "").trim();
  if (!original) throw new AccountingValidationError("Choose a file");
  if (original.length > 120) throw new AccountingValidationError("The file name is too long");
  if (/[\\/\u0000]/.test(original) || original.includes("..")) throw new AccountingValidationError("The file name is not allowed");
  if (DANGEROUS_EXT.test(original)) throw new AccountingValidationError("This file type is not allowed. Upload a JPG, PNG or PDF only");
  const parts = original.toLowerCase().split(".");
  if (parts.length !== 2) throw new AccountingValidationError("Use a simple file name with one extension, e.g. receipt.jpg");
  const type = UPLOAD_TYPES.find((t) => t.ext.includes(parts[1]));
  if (!type) throw new AccountingValidationError("Only JPG, PNG or PDF files are allowed");

  const base64 = String(data ?? "").replace(/^data:[^;,]*;base64,/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || !base64) throw new AccountingValidationError("The file could not be read");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new AccountingValidationError("The file is empty");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new AccountingValidationError("The file is larger than 2 MB");
  if (!type.magic.every((byte, i) => buffer[i] === byte)) {
    throw new AccountingValidationError(`The file content is not a real ${type.ext[0].toUpperCase()} file`);
  }
  const text = buffer.toString("latin1").toLowerCase();
  if (SCRIPT_MARKERS.some((marker) => marker.test(text))) {
    throw new AccountingValidationError("The file contains script code and was rejected");
  }
  return { buffer, ext: type.ext[0], mime: type.mime, originalName: original, size: buffer.length };
}
