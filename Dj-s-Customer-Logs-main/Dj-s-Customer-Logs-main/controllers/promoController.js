import { Op } from "sequelize";
import { User } from "../models/userModel.js";
import { Customer, LoyaltyRecord, Promo, PromoRedemption } from "../models/customerRelations.js";
import { netPurchaseCount } from "../modules/customerLogs/services/CustomerLogService.js";
import { PromoService, normalizeCode } from "../modules/customerLogs/services/PromoService.js";

const peso = (n) => `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const findUser = async (req, res, allowedRoles) => {
  if (!req.session.userId) {
    res.redirect("/login");
    return null;
  }
  const user = await User.findByPk(req.session.userId);
  if (!user) {
    req.session.destroy(() => res.redirect("/login"));
    return null;
  }
  if (!allowedRoles.includes(user.role) && user.role !== "admin") {
    res.redirect(user.role === "staff" ? "/staff/dashboard" : "/login");
    return null;
  }
  return user;
};

// The promo fields from the admin forms. Returns { data } or { error }.
const readPromoForm = async (body, promoId = null) => {
  const name = String(body.name || "").trim();
  const mechanics = String(body.mechanics || "").trim();
  const code = normalizeCode(body.code) || null;
  const discountType = body.discountType === "fixed" ? "fixed" : "percent";
  const discountValue = Number(body.discountValue);
  const minimumSpend = Number(body.minimumSpend || 0);
  const pointsCost = Number.parseInt(body.pointsCost || 0, 10);
  const minimumPurchases = Number.parseInt(body.minimumPurchases || 0, 10);
  const { startDate, endDate } = body;
  if (!name || !mechanics || !startDate || !endDate) return { error: "Complete promo details are required" };
  if (new Date(endDate) < new Date(startDate)) return { error: "End date must not be before start date" };
  if (!Number.isFinite(discountValue) || discountValue < 0) return { error: "The discount value must be a positive number" };
  if (discountType === "percent" && discountValue > 100) return { error: "A percent discount cannot be more than 100%" };
  if (!Number.isFinite(minimumSpend) || minimumSpend < 0 || pointsCost < 0 || minimumPurchases < 0) {
    return { error: "Minimum spend, points cost and earlier purchases cannot be negative" };
  }
  if (code && !/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(code)) return { error: "Promo codes use letters, digits, - and _ (2 to 30 characters)" };
  if (code) {
    const taken = await Promo.findOne({ where: { code, ...(promoId ? { promoId: { [Op.ne]: promoId } } : {}) } });
    if (taken) return { error: `Promo code ${code} is already used by "${taken.name}"` };
  }
  return { data: { name, mechanics, code, discountType, discountValue, minimumSpend, pointsCost, minimumPurchases, startDate, endDate } };
};

const promoSummary = (p) =>
  `${p.discountType === "fixed" ? `${peso(p.discountValue)} off` : `${Number(p.discountValue)}% off`}` +
  `${Number(p.minimumSpend) > 0 ? ` · min. spend ${peso(p.minimumSpend)}` : ""}` +
  `${Number(p.pointsCost) > 0 ? ` · ${p.pointsCost} point(s)` : ""}` +
  ` · ${p.startDate} to ${p.endDate}`;

export const promoManagementPage = async (req, res) => {
  const user = await findUser(req, res, ["admin"]);
  if (!user) return;
  const promos = await Promo.findAll({ order: [["createdAt", "DESC"]] });
  const counts = await PromoRedemption.findAll({
    attributes: ["promoId", [PromoRedemption.sequelize.fn("COUNT", PromoRedemption.sequelize.col("id")), "n"]],
    where: { status: "Redeemed" },
    group: ["promoId"],
    raw: true
  });
  const used = new Map(counts.map((c) => [c.promoId, Number(c.n)]));
  res.render("promoManagement", {
    title: "Promo Management",
    user,
    promos: promos.map((p) => ({ ...p.toJSON(), summary: promoSummary(p), redeemed: used.get(p.promoId) || 0 }))
  });
};

export const createPromo = async (req, res) => {
  const user = await findUser(req, res, ["admin"]);
  if (!user) return;
  const { data, error } = await readPromoForm(req.body);
  if (error) return res.status(400).send(error);
  await Promo.create(data);
  res.redirect("/admin/promo-management");
};

export const updatePromoStatus = async (req, res) => {
  const user = await findUser(req, res, ["admin"]);
  if (!user) return;
  const promo = await Promo.findByPk(req.params.promoId);
  if (!promo) return res.status(404).send("Promo not found");
  await promo.update({ status: promo.status === "active" ? "inactive" : "active" });
  res.redirect("/admin/promo-management");
};

export const updatePromo = async (req, res) => {
  const user = await findUser(req, res, ["admin"]);
  if (!user) return;
  const promo = await Promo.findByPk(req.params.promoId);
  if (!promo) return res.status(404).send("Promo not found");
  const { data, error } = await readPromoForm(req.body, promo.promoId);
  if (error) return res.status(400).send(error);
  await promo.update(data);
  res.redirect("/admin/promo-management");
};

export const deletePromo = async (req, res) => {
  const user = await findUser(req, res, ["admin"]);
  if (!user) return;
  const promo = await Promo.findByPk(req.params.promoId);
  if (!promo) return res.status(404).send("Promo not found");
  const redemptions = await PromoRedemption.count({ where: { promoId: promo.promoId } });
  if (redemptions) return res.status(409).send("Promos with redemption history cannot be deleted");
  await promo.destroy();
  res.redirect("/admin/promo-management");
};

export const promoRedemptionPage = async (req, res) => {
  const user = await findUser(req, res, ["staff"]);
  if (!user) return;
  const search = String(req.query.search || "").trim();
  const [customers, promos, redemptions, loyalty] = await Promise.all([
    Customer.findAll({ where: { status: "ACTIVE" }, order: [["name", "ASC"]] }),
    Promo.findAll({ where: { status: "active" }, order: [["name", "ASC"]] }),
    PromoRedemption.findAll({ include: [Customer, Promo], order: [["redemptionDate", "DESC"]], limit: 100 }),
    LoyaltyRecord.findAll({ raw: true })
  ]);
  const points = new Map(loyalty.map((l) => [l.customerId, l.pointsBalance]));
  const customerRows = [];
  for (const customer of customers) {
    customerRows.push({ ...customer.toJSON(), purchases: await netPurchaseCount(customer.customerId), points: points.get(customer.customerId) || 0 });
  }
  const searchValue = search.toLowerCase();
  const records = redemptions.map((r) => ({
    ...r.toJSON(),
    customerName: r.Customer?.name || "Unknown customer",
    customerId: r.Customer?.customerId || r.customerId,
    dateText: new Date(r.redemptionDate).toLocaleString("en-PH"),
    discountText: peso(r.discountAmount)
  })).filter((record) => {
    if (!searchValue) return true;
    return [record.customerName, record.customerId, record.promoName, record.promoCode, record.transactionReference]
      .some((value) => String(value || "").toLowerCase().includes(searchValue));
  });
  res.render("promoRedemption", {
    title: "Promo Records",
    customers: customerRows,
    promos: promos.map((p) => p.toJSON()),
    redemptions: records,
    search,
    message: req.query.message ? String(req.query.message).slice(0, 300) : null
  });
};

const back = (res, message) => res.redirect(`/staff/modules/promos?message=${encodeURIComponent(message)}`);

export const recordRedemption = async (req, res) => {
  const user = await findUser(req, res, ["staff"]);
  if (!user) return;
  const { customerId, promoId, subtotal, transactionReference } = req.body;
  const promo = await Promo.findByPk(promoId);
  if (!promo || promo.status !== "active") return back(res, "Select a valid active promo");
  try {
    if (promo.code) {
      const { redemption, duplicate } = await PromoService.redeem({
        code: promo.code,
        customerId,
        subtotal,
        transactionReference: String(transactionReference || "").trim() || null,
        source: "Customer Logs",
        userId: user.id
      });
      return back(res, duplicate ? "That reference already has this promo recorded" : `Recorded ${promo.name}: ${peso(redemption.discountAmount)} off`);
    }
    // A promo without a code (older promos): only the earlier-purchase requirement applies.
    const customer = await Customer.findByPk(customerId);
    if (!customer) return back(res, "Select a valid customer");
    const purchases = await netPurchaseCount(customerId);
    if (purchases < promo.minimumPurchases) return back(res, "Customer is not eligible for this promo");
    await PromoRedemption.create({ customerId, promoId, promoName: promo.name, source: "Customer Logs", recordedByUserId: user.id });
    back(res, `Recorded ${promo.name}`);
  } catch (error) {
    back(res, error.message || "Could not record the redemption");
  }
};

export const voidRedemption = async (req, res) => {
  const user = await findUser(req, res, ["staff"]);
  if (!user) return;
  try {
    const { voided } = await PromoService.voidRedemption({ id: Number(req.params.id), reason: String(req.body.reason || "").trim() || `Voided by ${user.name}` });
    back(res, voided ? "Redemption voided; points given back" : "That redemption was already voided");
  } catch (error) {
    back(res, error.message || "Could not void the redemption");
  }
};
