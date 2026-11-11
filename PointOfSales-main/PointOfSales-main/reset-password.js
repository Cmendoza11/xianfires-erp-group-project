// Sets a new password for a POS & Inventory account. The login page has no e-mail reset, so an
// administrator runs this on the server:
//   npm run user:password -- --email pos@djs.test --password NewSecret123
//   npm run user:password -- --email pos@djs.test --password NewSecret123 --db xianfires_erp_qa
// --db picks the database (default: DB_NAME from the environment, else xianfires_erp).
import { parseArgs } from "node:util";
import bcrypt from "bcrypt";

const { values } = parseArgs({
  options: {
    email: { type: "string", short: "e" },
    password: { type: "string", short: "p" },
    db: { type: "string" },
  },
});

const email = String(values.email || "").trim().toLowerCase();
const password = values.password || "";
if (!email || password.length < 6) {
  console.error("Usage: npm run user:password -- --email <email> --password <at least 6 characters> [--db <database>]");
  process.exit(1);
}
// The database must be chosen before the models connect.
if (values.db) process.env.DB_NAME = values.db;

const { sequelize, User } = await import("./models/index.js");
try {
  const user = await User.findOne({ where: { email } });
  if (!user) {
    const emails = (await User.findAll({ attributes: ["email"], raw: true })).map((u) => u.email);
    console.error(`❌ No POS account with email ${email} in ${sequelize.config.database}.`);
    console.error(emails.length ? `   POS accounts there: ${emails.join(", ")}` : "   That database has no POS accounts yet; register the first one at /register.");
    process.exitCode = 1;
  } else {
    await user.update({ password: await bcrypt.hash(password, 10) });
    console.log(`✅ Password changed for ${email} (${user.role}) in ${sequelize.config.database}. It is case-sensitive.`);
  }
} catch (error) {
  console.error("❌ Could not change the password:", error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close().catch(() => {});
}
