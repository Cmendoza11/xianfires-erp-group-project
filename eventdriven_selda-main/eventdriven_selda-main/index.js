/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    
import express from "express";
import path from "path";
import session from "express-session";
import flash from "connect-flash";
import router from "./routes/index.js";
import fs from 'fs';
import hbs from "hbs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname } from "path";
import { erpModules } from "./middleware/erpModules.js";
import { refreshDepartmentsFromHr } from "./services/hrDirectory.js";
import { refreshPaymentsBeforePage, startIntegrationWorker } from "./services/integrationWorker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), "public")));

// Own cookie name: the 5 ERP modules share localhost, and cookies are not separated by port.
app.use(session({
  name: "xf_scm.sid",
  secret: process.env.SESSION_SECRET || "xianfire-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));
app.use(flash());

app.engine("xian", async (filePath, options, callback) => {
  try {
     const originalPartialsDir = hbs.partialsDir;
    hbs.partialsDir = path.join(__dirname, 'views');

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
// Register Handlebars / .xian Custom Helpers
hbs.registerHelper("eq", function (a, b, options) {
  const result = a == b;
  if (options && typeof options.fn === "function") {
    return result ? options.fn(this) : options.inverse(this);
  }
  return result;
});

hbs.registerHelper("neq", function (a, b, options) {
  const result = a != b;
  if (options && typeof options.fn === "function") {
    return result ? options.fn(this) : options.inverse(this);
  }
  return result;
});

hbs.registerHelper("gt", function (a, b, options) {
  const result = parseFloat(a) > parseFloat(b);
  if (options && typeof options.fn === "function") {
    return result ? options.fn(this) : options.inverse(this);
  }
  return result;
});

hbs.registerHelper("gte", function (a, b, options) {
  const result = parseFloat(a) >= parseFloat(b);
  if (options && typeof options.fn === "function") {
    return result ? options.fn(this) : options.inverse(this);
  }
  return result;
});

hbs.registerHelper("lt", function (a, b, options) {
  const result = parseFloat(a) < parseFloat(b);
  if (options && typeof options.fn === "function") {
    return result ? options.fn(this) : options.inverse(this);
  }
  return result;
});

hbs.registerHelper("lte", function (a, b, options) {
  const result = parseFloat(a) <= parseFloat(b);
  if (options && typeof options.fn === "function") {
    return result ? options.fn(this) : options.inverse(this);
  }
  return result;
});

hbs.registerHelper("formatDate", function (dateStr) {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  } catch (e) {
    return dateStr;
  }
});

hbs.registerHelper("formatDateTime", function (dateStr) {
  if (!dateStr) return "N/A";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch (e) {
    return dateStr;
  }
});

hbs.registerHelper("formatCurrency", function (amount) {
  const val = parseFloat(amount);
  if (isNaN(val)) return "₱0.00";
  return "₱" + val.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

hbs.registerHelper("statusBadge", function (status) {
  const s = (status || "").toLowerCase();
  let color = "bg-zinc-800 text-gray-300 border-zinc-700";
  if (["active", "approved", "fully received", "completed", "paid", "synced"].includes(s)) {
    color = "bg-emerald-950/80 text-emerald-400 border-emerald-800";
  } else if (["pending", "pending approval", "draft"].includes(s)) {
    color = "bg-amber-950/80 text-amber-400 border-amber-800";
  } else if (["partially received", "partially paid", "sent to supplier"].includes(s)) {
    color = "bg-blue-950/80 text-blue-400 border-blue-800";
  } else if (["inactive", "cancelled", "rejected", "failed", "overdue"].includes(s)) {
    color = "bg-red-950/80 text-red-400 border-red-800";
  }
  return new hbs.SafeString(`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${color}">${status || "N/A"}</span>`);
});

hbs.registerHelper("json", function (context) {
  return JSON.stringify(context);
});

hbs.registerHelper("math", function (lvalue, operator, rvalue) {
  lvalue = parseFloat(lvalue) || 0;
  rvalue = parseFloat(rvalue) || 0;
  return {
    "+": lvalue + rvalue,
    "-": lvalue - rvalue,
    "*": lvalue * rvalue,
    "/": rvalue !== 0 ? lvalue / rvalue : 0,
    "%": rvalue !== 0 ? lvalue % rvalue : 0,
  }[operator] || 0;
});

app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  res.locals.successMessage = req.session.success || null;
  res.locals.errorMessage = req.session.error || null;
  delete req.session.success;
  delete req.session.error;
  res.locals.user = req.session.user || { name: "System Administrator", role: "admin" };
  next();
});


app.set("views", path.join(__dirname, "views"));
app.set("view engine", "xian");
const partialsDir = path.join(__dirname, "views/partials");
fs.readdir(partialsDir, (err, files) => {
  if (err) {
    console.error("❌ Could not read partials directory:", err);
    return;
  }

   files
    .filter(file => file.endsWith('.xian'))
    .forEach(file => {
      const partialName = file.replace('.xian', ''); 
      const fullPath = path.join(partialsDir, file);

      fs.readFile(fullPath, 'utf8', (err, content) => {
        if (err) {
          console.error(`❌ Failed to read partial: ${file}`, err);
          return;
        }
        hbs.registerPartial(partialName, content);
        
      });
    });
});

app.use(erpModules);
// Departments come from HR: refresh the read-only mirror before pages that list them.
app.use(["/departments", "/purchase-requests", "/purchase-orders"], refreshDepartmentsFromHr);
// Supplier invoice pages show the payment status Accounting has right now.
app.use("/supplier-invoices", refreshPaymentsBeforePage);
app.use("/", router);

export default app;

// Start the HTTP server; resolves once the server is listening.
// Exported so the Electron main process can control startup itself.
export const startServer = (port = PORT) => {
  // Retries deliveries, bills and refunds that could not reach POS or Accounting yet.
  startIntegrationWorker();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`🔥 XianFire running at http://localhost:${port}`);
      resolve(server);
    });
    server.on("error", reject);
  });
};

// Auto-start only when executed directly (node index.js).
// When imported by electron/main.js, Electron manages the server lifecycle.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun && !process.env.XIAN_ELECTRON) {
  startServer();
}
