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
import indexRoutes from "./routes/index.js";
import { initializeDatabase, syncDatabase } from "./config/database.js";
import customerApi from "./modules/customerLogs/api/customerApi.js";
import customerLogApi from "./modules/customerLogs/api/customerLogApi.js";
import { requireErpKey } from "./middleware/erpKey.js";
import { erpModules } from "./middleware/erpModules.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// Initialize database on startup
try {
  await initializeDatabase();
  await syncDatabase();
} catch (error) {
  console.error("❌ Failed to initialize ERP system:", error);
  process.exit(1);
}

hbs.registerHelper("ifEquals", function (left, right, options) {
  return left === right ? options.fn(this) : options.inverse(this);
});
hbs.registerHelper("unlessEquals", function (left, right, options) {
  return left !== right ? options.fn(this) : options.inverse(this);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), "public")));

// Own cookie name: the 5 ERP modules share localhost, and cookies are not separated by port.
app.use(session({
  name: "xf_crm.sid",
  secret: process.env.SESSION_SECRET || "xianfire-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));
app.use(flash());

const partialsDir = path.join(__dirname, "views/partials");
const registerAllPartials = () => {
  try {
    const files = fs.readdirSync(partialsDir);
    files
      .filter(file => file.endsWith('.xian'))
      .forEach(file => {
        const partialName = file.replace('.xian', '');
        const fullPath = path.join(partialsDir, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        hbs.registerPartial(partialName, content);
      });
  } catch (err) {
    console.error("❌ Failed to register partials:", err);
  }
};
registerAllPartials();

app.engine("xian", async (filePath, options, callback) => {
  try {
    registerAllPartials();
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

app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  next();
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "xian");

// ==================== ERP API Routes ====================
// Customer Module API - for inter-module communication
// Only other ERP modules call these, with the shared X-ERP-Key (the web UI does not use /api).
app.use("/api/customers", requireErpKey, customerApi);
app.use("/api/customer-logs", requireErpKey, customerLogApi);

// ==================== Web UI Routes ====================
app.use(erpModules);
app.use("/", indexRoutes);

export default app;

// Start the HTTP server; resolves once the server is listening.
// Exported so the Electron main process can control startup itself.
export const startServer = (port = PORT) => {
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
