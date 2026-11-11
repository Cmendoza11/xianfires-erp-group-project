import { Op } from "sequelize";
import { User } from "../models/userModel.js";
import { Customer, CustomerLog, Promo, PromoRedemption } from "../models/customerRelations.js";
import { netPurchaseCount } from "../modules/customerLogs/services/CustomerLogService.js";

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

export const promoManagementPage = async (req, res) => {
  const user = await findUser(req, res, ["admin"]);
  if (!user) return;
  const promos = await Promo.findAll({ order: [["createdAt", "DESC"]] });
  res.render("promoManagement", { title: "Promo Management", promos, user });
};

export const createPromo = async (req, res) => {
  const user = await findUser(req, res, ["admin"]);
  if (!user) return;
  const { name, mechanics, minimumPurchases, startDate, endDate } = req.body;
  if (!name || !mechanics || !startDate || !endDate || Number(minimumPurchases) < 0) {
    return res.status(400).send("Complete promo details are required");
  }
  if (new Date(endDate) < new Date(startDate)) return res.status(400).send("End date must not be before start date");
  await Promo.create({ name, mechanics, minimumPurchases: Number(minimumPurchases), startDate, endDate });
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
  const { name, mechanics, minimumPurchases, startDate, endDate } = req.body;
  if (!name || !mechanics || !startDate || !endDate || Number(minimumPurchases) < 0) {
    return res.status(400).send("Complete promo details are required");
  }
  if (new Date(endDate) < new Date(startDate)) return res.status(400).send("End date must not be before start date");
  await promo.update({ name, mechanics, minimumPurchases: Number(minimumPurchases), startDate, endDate });
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
  const [customers, promos, redemptions] = await Promise.all([
    Customer.findAll({ order: [["name", "ASC"]] }),
    Promo.findAll({ where: { status: "active" }, order: [["name", "ASC"]] }),
    PromoRedemption.findAll({ include: [Customer, Promo], order: [["redemptionDate", "DESC"]], limit: 50 })
  ]);
  const eligibleCustomers = [];
  for (const customer of customers) {
    const purchases = await netPurchaseCount(customer.customerId);
    eligibleCustomers.push({ ...customer.toJSON(), purchases });
  }
  const searchValue = search.toLowerCase();
  const promoRecords = redemptions.map((redemption) => {
    const purchases = eligibleCustomers.find((customer) => customer.customerId === redemption.customerId)?.purchases || 0;
    const minimumPurchases = redemption.Promo?.minimumPurchases || 0;
    return {
      ...redemption.toJSON(),
      customerName: redemption.Customer?.name || "Unknown customer",
      customerId: redemption.Customer?.customerId || redemption.customerId,
      eligibilityStatus: purchases >= minimumPurchases ? "Eligible" : "Not eligible",
      redeemedStatus: "Redeemed"
    };
  }).filter((record) => {
    if (!searchValue) return true;
    return [record.customerName, record.customerId, record.promoName]
      .some((value) => String(value || "").toLowerCase().includes(searchValue));
  });
  res.render("promoRedemption", {
    title: "Promo Records",
    customers: eligibleCustomers,
    promos: promos.map((p) => p.toJSON()),
    redemptions: promoRecords,
    search
  });
};

export const recordRedemption = async (req, res) => {
  const user = await findUser(req, res, ["staff"]);
  if (!user) return;
  const { customerId, promoId } = req.body;
  const [customer, promo] = await Promise.all([Customer.findByPk(customerId), Promo.findByPk(promoId)]);
  if (!customer || !promo || promo.status !== "active") return res.status(400).send("Select a valid active customer promo");
  const purchases = await netPurchaseCount(customerId);
  if (purchases < promo.minimumPurchases) return res.status(409).send("Customer is not eligible for this promo");
  await PromoRedemption.create({ customerId, promoId, promoName: promo.name, source: "Customer Logs", recordedByUserId: user.id });
  res.redirect("/staff/modules/promos");
};
