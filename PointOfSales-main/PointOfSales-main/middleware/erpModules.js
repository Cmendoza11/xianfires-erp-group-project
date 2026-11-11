// Links to the other DJ's ERP modules for the sidebar. URLs come from the root .env via `npm run dev`.
const MODULES = [
  { code: "erp", label: "Accounting", icon: "💰", port: 3000 },
  { code: "pos", label: "POS & Inventory", icon: "🧾", port: 3001 },
  { code: "hr", label: "Human Resources", icon: "👥", port: 3002 },
  { code: "scm", label: "Procurement", icon: "🚚", port: 3003 },
  { code: "crm", label: "Customer Logs", icon: "⭐", port: 3004 }
];

const ERP_MODULES = MODULES.map((m) => ({
  ...m,
  url: process.env[`ERP_URL_${m.code.toUpperCase()}`] || `http://localhost:${m.port}`,
  current: m.code === "pos"
}));

export function erpModules(req, res, next) {
  res.locals.erpModules = ERP_MODULES;
  next();
}
