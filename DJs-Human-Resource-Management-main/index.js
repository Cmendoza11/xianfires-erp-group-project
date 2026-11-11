/*
    DJs Human Resource Management System
    Built on the XianFire Framework (Christian I. Cabrera, Mindoro State University)
*/

import express from "express";
import path from "path";
import fs from "fs";
import session from "express-session";
import flash from "connect-flash";
import hbs from "hbs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname } from "path";

import router from "./routes/index.js";
import { syncDatabase } from "./models/index.js";
import { attachUser } from "./middleware/authMiddleware.js";
import { erpModules } from "./middleware/erpModules.js";
import { startAccountingSync } from "./services/accountingSync.js";
import {
  formatDate,
  formatTime,
  formatDateTime,
  formatMoney,
  formatNumber
} from "./utils/format.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    // Own cookie name: the 5 ERP modules share localhost, and cookies are not separated by port.
    name: "xf_hr.sid",
    secret: process.env.SESSION_SECRET || "xianfire-hrms-dev-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);
app.use(flash());

app.engine("xian", async (filePath, options, callback) => {
  try {
    const originalPartialsDir = hbs.partialsDir;
    hbs.partialsDir = path.join(__dirname, "views");

    const result = await new Promise((resolve, reject) => {
      hbs.__express(filePath, options, (err, html) => {
        if (err) return reject(err);
        resolve(html);
      });
    });

    hbs.partialsDir = originalPartialsDir;
    callback(null, result);
  } catch (err) {
    callback(err);
  }
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "xian");

// Partials are registered synchronously so every route has them available.
const partialsDir = path.join(__dirname, "views", "partials");
fs.readdirSync(partialsDir)
  .filter((file) => file.endsWith(".xian"))
  .forEach((file) => {
    hbs.registerPartial(
      file.replace(".xian", ""),
      fs.readFileSync(path.join(partialsDir, file), "utf8")
    );
  });

hbs.registerHelper("eq", (a, b) => a === b);
hbs.registerHelper("concat", (...args) => args.slice(0, -1).join(""));
hbs.registerHelper("array", (...args) => args.slice(0, -1));
hbs.registerHelper("urlEncode", (value) => encodeURIComponent(String(value ?? "")));
hbs.registerHelper("ne", (a, b) => a !== b);
hbs.registerHelper("gt", (a, b) => Number(a) > Number(b));
hbs.registerHelper("startsWith", (value, prefix) => String(value || "").startsWith(prefix));
hbs.registerHelper("formatDate", formatDate);
hbs.registerHelper("formatTime", formatTime);
hbs.registerHelper("formatDateTime", formatDateTime);
hbs.registerHelper("formatMoney", formatMoney);
hbs.registerHelper("formatNumber", formatNumber);
hbs.registerHelper("dash", (value) => (value === 0 ? 0 : value || "—"));
hbs.registerHelper("json", (value) => JSON.stringify(value));

app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  next();
});

app.use(erpModules);
app.use(attachUser);
app.use("/", router);

app.use((req, res) => {
  res.status(404).render("404", { title: "Page Not Found | DJs HRMS" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("❌ Request failed:", err);
  if (res.headersSent) return;
  res.status(500).render("500", { title: "Server Error | DJs HRMS" });
});

export default app;

// Resolves once the server is listening and the database is ready.
export const startServer = async (port = PORT) => {
  await syncDatabase();
  console.log("✅ Connected to MySQL");
  // Retries paid payroll that could not reach the Accounting ERP yet.
  startAccountingSync();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`🔥 XianFire running at http://localhost:${port}`);
      resolve(server);
    });
    server.on("error", reject);
  });
};

// Auto-start only when executed directly (node index.js).
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun && !process.env.XIAN_ELECTRON) {
  startServer().catch((err) => {
    console.error("❌ Failed to start:", err.message);
    process.exit(1);
  });
}
