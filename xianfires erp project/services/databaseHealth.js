import { sequelize } from "../models/db.js";

// Errors that mean "MySQL cannot be reached", not "the query was wrong".
const CONNECTION_ERRORS = new Set([
  "SequelizeConnectionError",
  "SequelizeConnectionRefusedError",
  "SequelizeHostNotFoundError",
  "SequelizeHostNotReachableError",
  "SequelizeConnectionTimedOutError",
  "SequelizeConnectionAcquireTimeoutError",
  "SequelizeAccessDeniedError"
]);
const CONNECTION_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "ECONNRESET", "PROTOCOL_CONNECTION_LOST"]);

export const DATABASE_OFFLINE_MESSAGE = "The database is offline. Make sure MySQL is running on the host laptop, then try again.";

// Sequelize wraps the driver error, so look through original / parent / cause too.
export function isDatabaseDown(err) {
  for (let e = err, depth = 0; e && depth < 4; e = e.original || e.parent || e.cause, depth++) {
    if (CONNECTION_ERRORS.has(e.name) || CONNECTION_CODES.has(e.code)) return true;
  }
  return false;
}

// True when `SELECT 1` answers within the time limit.
export async function pingDatabase(timeoutMs = 3000) {
  let timer;
  try {
    await Promise.race([
      sequelize.query("SELECT 1"),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); })
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
