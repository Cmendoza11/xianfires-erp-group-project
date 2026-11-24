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

import "dotenv/config";
import express from "express";
import path from "path";
import session from "express-session";
import router from "./routes/index.js";
import fs from 'fs';
import hbs from "hbs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { registerHelpers } from "./services/viewHelpers.js";
import { enforceSessionTimeout, loadAdminUser } from "./middleware/auth.js";
import { rateLimit, securityHeaders } from "./services/securityService.js";
import { erpModules } from "./middleware/erpModules.js";
import { notFoundPage } from "./controllers/homeController.js";
import { urls } from "./routes/urls.js";
import { DATABASE_OFFLINE_MESSAGE, isDatabaseDown } from "./services/databaseHealth.js";
import { logError } from "./services/errorLog.js";
import { MySqlSessionStore } from "./services/sessionStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.error("❌ SESSION_SECRET is not set. Copy .env.example to .env and set it.");
  process.exit(1);
}

app.disable("x-powered-by");
// Behind a host's HTTPS proxy (Hostinger, Nginx): read the real client IP for rate limits and mark cookies secure.
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
const secureCookie = process.env.COOKIE_SECURE === "true";
app.use(securityHeaders);
// Receipts are sent as base64 JSON (max 2 MB file), so only the voucher API accepts a bigger body.
app.use("/api/expense-vouchers", express.json({ limit: "4mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Own cookie name: the 5 ERP modules share localhost, and cookies are not separated by port.
app.use(session({
  name: "xf_erp.sid",
  secret: process.env.SESSION_SECRET,
  // Sessions live in MySQL, so a server restart does not log everyone out.
  store: new MySqlSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: "lax", secure: secureCookie, maxAge: 30 * 60_000 }
}));
app.use(enforceSessionTimeout);
// Every JSON API: at most 300 requests a minute per address (the other ERP modules use /api/v1).
app.use("/api/v1", rateLimit({ name: "erp-api", limit: 600 }));
const apiLimit = rateLimit({ name: "api", limit: 300 });
app.use("/api", (req, res, next) => (req.path.startsWith("/v1/") ? next() : apiLimit(req, res, next)));

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

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "xian");
registerHelpers();
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

app.use(loadAdminUser);
app.use(erpModules);
app.use("/", router);
app.use(notFoundPage);

// Unexpected errors are logged server-side only; the client gets a generic message.
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: { status: 413, message: "The upload is too large. The limit is 2 MB." } });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: { status: 400, message: "Invalid JSON body" } });
  }
  if (res.headersSent) return next(err);
  // MySQL unreachable: say so plainly (503) instead of a generic error, and keep the server running.
  if (isDatabaseDown(err)) {
    console.error(`❌ [${new Date().toISOString()}] Database offline: ${err.original?.code || err.parent?.code || err.message}`);
    logError(err.original?.code || err.parent?.code || err.message, req, "database offline");
    if (req.path.startsWith("/api/") || req.is("application/json")) {
      return res.status(503).json({ error: { status: 503, message: DATABASE_OFFLINE_MESSAGE } });
    }
    return res.status(503).render("error", { title: "Database offline", heading: "Database is offline", message: DATABASE_OFFLINE_MESSAGE, retry: true, urls });
  }
  console.error(`❌ [${new Date().toISOString()}]`, err);
  logError(err, req);
  const message = "Something went wrong! Please try again.";
  if (req.path.startsWith("/api/") || req.is("application/json")) {
    return res.status(500).json({ error: { status: 500, message } });
  }
  res.status(500).render("error", { title: "Error", message, urls });
});

export default app;

if (!process.env.ELECTRON) {
  app.listen(PORT, () => console.log(`🔥 XianFire running at http://localhost:${PORT}`));
}
