import crypto from "node:crypto";

// Other DJ's ERP modules (e.g. Procurement) call /api/v1/inventory with the shared X-ERP-Key
// from the root .env. Browsers never call these routes.
export function requireErpKey(req, res, next) {
  const expected = process.env.ERP_INTERNAL_KEY || "";
  const given = String(req.get("X-ERP-Key") || "");
  if (!expected) {
    return res.status(503).json({ error: { status: 503, message: "ERP_INTERNAL_KEY is not configured. Run `npm run migrate` at the ERP root." } });
  }
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: { status: 401, message: "Missing or invalid X-ERP-Key" } });
  }
  next();
}
