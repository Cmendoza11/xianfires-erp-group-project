import { Op, fn, col, where } from "sequelize";
import { User } from "../models/userModel.js";
import {
  Customer,
  CustomerLog,
  PromoRedemption,
  LoyaltyRecord
} from "../models/customerRelations.js";
import { CustomerLogService, netPurchaseCount } from "../modules/customerLogs/services/CustomerLogService.js";

// Tables are created by `npm run migrate` / app start-up (config/database.js), not at import time.

const moduleDefinitions = {
  customers: { title: "Customers", description: "Register, search, and manage customer records." },
  logs: { title: "Customer Logs", description: "Record each visit or transaction against an existing customer." },
  promos: { title: "Promo Redemption Records", description: "Review promo eligibility and redemption history received from POS." },
  loyalty: { title: "Loyalty Records", description: "Review purchase-based loyalty points, status, and customer summaries." },
  reports: { title: "Reports", description: "Review customer activity and promo summaries." }
};

const findStaff = async (req, res) => {
  if (!req.session.userId) {
    res.redirect("/login");
    return null;
  }
  const user = await User.findByPk(req.session.userId);
  if (!user) {
    req.session.destroy(() => res.redirect("/login"));
    return null;
  }
  if (!["staff", "admin"].includes(user.role)) {
    res.status(403).send("Staff or admin access required");
    return null;
  }
  return user;
};

export const customerLogsDashboard = async (req, res) => {
  const user = await findStaff(req, res);
  if (!user) return;
  const [totalCustomers, totalLogs, todayPurchases, recentLogs, promoCount, purchaseLogs] = await Promise.all([
    Customer.count(),
    CustomerLog.count({ where: { activityType: "purchase" } }),
    CustomerLog.count({ where: { activityType: "purchase", [Op.and]: [where(fn("DATE", col("activityAt")), fn("CURDATE"))] } }),
    CustomerLog.findAll({
      include: [{ model: Customer, attributes: ["customerId", "name"] }],
      order: [["activityAt", "DESC"]],
      limit: 5
    }),
    PromoRedemption.count(),
    CustomerLog.findAll({
      where: { activityType: "purchase" },
      include: [{ model: Customer, attributes: ["customerId", "name"] }],
      order: [["activityAt", "DESC"]]
    })
  ]);
  const purchaseCounts = new Map();
  for (const log of purchaseLogs) {
    const key = log.customerId;
    const current = purchaseCounts.get(key) || { customerId: key, name: log.Customer.name, purchases: 0 };
    current.purchases += 1;
    purchaseCounts.set(key, current);
  }
  const topCustomers = [...purchaseCounts.values()]
    .sort((left, right) => right.purchases - left.purchases)
    .slice(0, 3);
  const chartDays = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    chartDays.push({
      label: date.toLocaleDateString("en-US", { weekday: "short" }),
      date: date.toISOString().slice(0, 10),
      purchases: 0
    });
  }
  for (const log of purchaseLogs) {
    const day = chartDays.find((item) => item.date === new Date(log.activityAt).toISOString().slice(0, 10));
    if (day) day.purchases += 1;
  }
  const chartMax = Math.max(...chartDays.map((day) => day.purchases), 1);
  for (const day of chartDays) {
    day.height = Math.max((day.purchases / chartMax) * 82, 2);
  }
  res.render("staffDashboard", {
    title: "CustomerLogs Staff Dashboard",
    user,
    stats: { totalCustomers, totalLogs, todayPurchases, promoCount },
    recentLogs,
    topCustomers,
    chartDays,
    chartMax
  });
};

export const customerModulePage = async (req, res) => {
  const user = await findStaff(req, res);
  if (!user) return;
  const module = moduleDefinitions[req.params.module];
  if (!module) return res.status(404).send("Customer Logs module not found");
  const search = String(req.query.search || "").trim();
  let records = [];
  let customers = [];
  if (req.params.module === "customers") {
    const whereClause = search ? {
      [Op.or]: [
        { name: { [Op.like]: `%${search}%` } },
        { contactNumber: { [Op.like]: `%${search}%` } },
        { customerId: { [Op.like]: `%${search}%` } }
      ]
    } : undefined;
    const rawCustomers = await Customer.findAll({ where: whereClause, order: [["createdAt", "DESC"]] });
    records = await Promise.all(rawCustomers.map(async (customer) => {
      const plain = customer.toJSON();
      plain.totalPurchases = await netPurchaseCount(customer.customerId);
      return plain;
    }));
  } else if (req.params.module === "reports") {
    const activityWhere = {
      activityType: "purchase",
      ...(req.query.date ? { activityAt: { [Op.gte]: new Date(`${req.query.date}T00:00:00`), [Op.lt]: new Date(`${req.query.date}T23:59:59.999`) } } : {})
    };
    if (req.query.search) {
      records = await Customer.findAll({
        where: {
          [Op.or]: [
            { name: { [Op.like]: `%${search}%` } },
            { contactNumber: { [Op.like]: `%${search}%` } },
            { customerId: { [Op.like]: `%${search}%` } }
          ]
        },
        include: [{ model: CustomerLog, where: activityWhere, include: [User] }]
      });
      records = records.flatMap((customer) => customer.CustomerLogs.map((log) => {
        log.dataValues.Customer = customer;
        return log;
      }));
    } else {
      records = await CustomerLog.findAll({
        where: activityWhere,
        include: [Customer, User],
        order: [["activityAt", "DESC"]],
        limit: 100
      });
    }
    const [totalCustomers, totalPurchases, totalRedemptions, allPurchases] = await Promise.all([
      Customer.count(),
      CustomerLog.count({ where: { activityType: "purchase" } }),
      PromoRedemption.count(),
      CustomerLog.findAll({ where: { activityType: "purchase" }, attributes: ["amount"] })
    ]);
    const totalRevenue = allPurchases.reduce((sum, log) => sum + Number(log.amount || 0), 0).toFixed(2);
    const reportStats = { totalCustomers, totalPurchases, totalRevenue, totalRedemptions };
    res.render("module", {
      title: `CustomerLogs ${module.title}`,
      module,
      moduleKey: req.params.module,
      records,
      customers,
      search,
      date: req.query.date || "",
      reportStats
    });
    return;
  } else if (req.params.module === "logs") {
    customers = await Customer.findAll({ order: [["name", "ASC"]] });
    const activityWhere = {
      ...(req.query.type ? { activityType: String(req.query.type) } : { activityType: "purchase" }),
      ...(req.query.date ? { activityAt: { [Op.gte]: new Date(`${req.query.date}T00:00:00`) } } : {})
    };
    if (req.query.date) {
      activityWhere.activityAt[Op.lt] = new Date(`${req.query.date}T23:59:59.999`);
    }
    if (req.query.search) {
      records = await Customer.findAll({
        where: {
          [Op.or]: [
            { name: { [Op.like]: `%${search}%` } },
            { contactNumber: { [Op.like]: `%${search}%` } },
            { customerId: { [Op.like]: `%${search}%` } }
          ]
        },
        include: [{ model: CustomerLog, where: activityWhere, include: [User] }]
      });
      records = records.flatMap((customer) => customer.CustomerLogs.map((log) => {
        log.dataValues.Customer = customer;
        return log;
      }));
    } else {
      records = await CustomerLog.findAll({
        where: activityWhere,
        include: [Customer, User],
        order: [["activityAt", "DESC"]],
        limit: 50
      });
    }
  } else if (req.params.module === "promos") {
    records = await PromoRedemption.findAll({ include: [Customer], order: [["redemptionDate", "DESC"]], limit: 50 });
  } else if (req.params.module === "loyalty") {
    const loyaltySearch = search.toLowerCase();
    const status = String(req.query.status || "").trim();
    const date = String(req.query.date || "").trim();
    const customersWithLogs = await Customer.findAll({
      include: [CustomerLog, LoyaltyRecord],
      order: [["name", "ASC"]]
    });
    const loyaltySummary = customersWithLogs.map((customer) => {
      const purchaseLogs = (customer.CustomerLogs || []).filter((log) => log.activityType === "purchase");
      // Refunds (e.g. a voided POS sale) take back the purchase, its amount and its point.
      const refundLogs = (customer.CustomerLogs || []).filter((log) => log.activityType === "refund");
      const loyalty = customer.LoyaltyRecord;
      const totalPurchases = Math.max(purchaseLogs.length - refundLogs.length, 0);
      const sumAmount = (logs) => logs.reduce((total, log) => total + Number(log.amount || 0), 0);
      const totalAmountSpent = Math.max(sumAmount(purchaseLogs) - sumAmount(refundLogs), 0);
      const loyaltyPointsEarned = totalPurchases;
      const availablePoints = loyalty ? Number(loyalty.pointsBalance || 0) : loyaltyPointsEarned;
      const pointsRedeemed = Math.max(loyaltyPointsEarned - availablePoints, 0);
      const loyaltyStatus = loyalty?.tier || (totalPurchases >= 10 ? "Gold" : totalPurchases >= 5 ? "Silver" : "Regular");
      const latestPurchase = purchaseLogs.reduce((latest, log) => {
        if (!latest || new Date(log.activityAt) > new Date(latest)) return log.activityAt;
        return latest;
      }, null);
      const rawDate = loyalty?.updatedAt || latestPurchase || customer.updatedAt;
      const validDate = rawDate && !isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : null;
      const lastUpdated = validDate ? validDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "N/A";
      const lastUpdatedAt = validDate ? validDate.toISOString().slice(0, 10) : "";
      return {
        customerId: customer.customerId,
        customerName: customer.name,
        totalPurchases,
        totalAmountSpent: totalAmountSpent.toFixed(2),
        loyaltyPointsEarned,
        pointsRedeemed,
        availablePoints,
        loyaltyStatus,
        lastUpdated,
        lastUpdatedAt
      };
    }).filter((record) => {
      const matchesSearch = !loyaltySearch ||
        record.customerName.toLowerCase().includes(loyaltySearch) ||
        record.customerId.toLowerCase().includes(loyaltySearch);
      const matchesStatus = !status || record.loyaltyStatus === status;
      const matchesDate = !date || record.lastUpdatedAt === date;
      return matchesSearch && matchesStatus && matchesDate;
    }).sort((left, right) => right.totalPurchases - left.totalPurchases);
    const topCustomers = loyaltySummary.slice(0, 3);
    const loyaltyStats = {
      totalCustomers: loyaltySummary.length,
      totalPointsEarned: loyaltySummary.reduce((total, record) => total + record.loyaltyPointsEarned, 0),
      pointsRedeemed: loyaltySummary.reduce((total, record) => total + record.pointsRedeemed, 0),
      topCustomers: topCustomers.length
    };
    res.render("module", {
      title: `CustomerLogs ${module.title}`,
      module,
      moduleKey: req.params.module,
      records,
      customers,
      search,
      date: req.query.date || "",
      loyaltySummary,
      loyaltyStats,
      topCustomers,
      status
    });
    return;
  }
  res.render("module", { title: `CustomerLogs ${module.title}`, module, moduleKey: req.params.module, records, customers, search, date: req.query.date || "" });
};

export const addCustomer = async (req, res) => {
  const user = await findStaff(req, res);
  if (!user) return;
  const { name, contactNumber, email } = req.body;
  if (!name || !contactNumber) return res.status(400).send("Name and contact number are required");
  const duplicate = await Customer.findOne({ where: { [Op.or]: [{ contactNumber }, ...(email ? [{ email }] : [])] } });
  if (duplicate) return res.status(409).send("A customer with this contact number or email already exists");
  await Customer.create({ name, contactNumber, email: email || null });
  res.redirect("/staff/modules/customers");
};

export const updateCustomer = async (req, res) => {
  const user = await findStaff(req, res);
  if (!user) return;
  const { name, contactNumber, email } = req.body;
  const customer = await Customer.findByPk(req.params.customerId);
  if (!customer || !name || !contactNumber) return res.status(400).send("Customer and required fields are missing");
  const duplicate = await Customer.findOne({
    where: {
      [Op.and]: [
        { customerId: { [Op.ne]: customer.customerId } },
        { [Op.or]: [{ contactNumber }, ...(email ? [{ email }] : [])] }
      ]
    }
  });
  if (duplicate) return res.status(409).send("Another customer has this contact number or email");
  await customer.update({ name, contactNumber, email: email || null });
  res.redirect("/staff/modules/customers");
};

export const deleteCustomer = async (req, res) => {
  const user = await findStaff(req, res);
  if (!user) return;
  const customer = await Customer.findByPk(req.params.customerId);
  if (!customer) return res.status(404).send("Customer not found");
  const logCount = await CustomerLog.count({ where: { customerId: customer.customerId } });
  if (logCount > 0) return res.status(409).send("Customers with activity logs cannot be deleted");
  await customer.destroy();
  res.redirect("/staff/modules/customers");
};

export const addCustomerLog = async (req, res) => {
  const user = await findStaff(req, res);
  if (!user) return;
  const { customerId, activityType, amount, transactionReference, activityAt } = req.body;
  const customer = await Customer.findByPk(customerId);
  if (!customer || !activityType) return res.status(400).send("A valid customer and activity type are required");
  if (activityType === "purchase" && (amount === "" || amount === undefined || Number.isNaN(Number(amount)) || Number(amount) < 0)) {
    return res.status(400).send("A valid purchase amount is required");
  }
  const parsedActivityAt = new Date(activityAt);
  if (!activityAt || Number.isNaN(parsedActivityAt.getTime())) {
    return res.status(400).send("A valid purchase date and time are required");
  }
  // Same service the POS uses, so totals and loyalty update the same way for staff entries.
  try {
    await CustomerLogService.recordLog(customerId, {
      activityType,
      amount: amount ? Number(amount) : null,
      transactionReference: transactionReference || null,
      activityAt: parsedActivityAt,
      sourceModule: "CRM",
      staff: user.name
    }, user.id, req.ip);
  } catch (error) {
    return res.status(error.status || 500).send(error.message);
  }
  res.redirect("/staff/modules/logs");
};

export { moduleDefinitions };
