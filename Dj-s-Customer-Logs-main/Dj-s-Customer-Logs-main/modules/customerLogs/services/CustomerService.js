/*
    Customer Logs Module - Customer Service
    Customer master data for the API (same tables as the web UI).
*/

import { Op } from "sequelize";
import { Customer, CustomerLog, LoyaltyRecord } from "../../../models/customerRelations.js";
import { AuditService } from "../../../core/AuditService.js";
import { MODULES } from "../../../config/constants.js";
import { CustomerLogError, netPurchaseCount, tierFor } from "./CustomerLogService.js";

const EDITABLE_FIELDS = ["name", "contactNumber", "email", "address", "status", "notes"];
const pick = (data) => Object.fromEntries(EDITABLE_FIELDS.filter((k) => data[k] !== undefined).map((k) => [k, data[k] === "" ? null : data[k]]));

export class CustomerService {

  static async createCustomer(customerData, userId, ipAddress) {
    const data = pick(customerData);
    if (!data.name || !data.contactNumber) throw new CustomerLogError("Name and contact number are required");
    const duplicate = await Customer.findOne({
      where: { [Op.or]: [{ contactNumber: data.contactNumber }, ...(data.email ? [{ email: data.email }] : [])] }
    });
    if (duplicate) throw new CustomerLogError("A customer with this contact number or email already exists", 409);
    const customer = await Customer.create(data);
    await AuditService.logCreate(MODULES.CUSTOMER_LOGS, "Customer", customer.customerId, { userId, ipAddress });
    return customer;
  }

  static async getCustomerById(customerId) {
    return Customer.findByPk(customerId);
  }

  static async getAllCustomers(limit = 50, offset = 0) {
    const { count, rows } = await Customer.findAndCountAll({ limit, offset, order: [["createdAt", "DESC"]] });
    return { total: count, customers: rows, page: Math.floor(offset / limit) + 1 };
  }

  static async updateCustomer(customerId, updates, userId, ipAddress) {
    const customer = await Customer.findByPk(customerId);
    if (!customer) throw new CustomerLogError("Customer not found", 404);
    const data = pick(updates);
    const changes = {};
    for (const [key, value] of Object.entries(data)) {
      if (customer[key] !== value) changes[key] = { from: customer[key], to: value };
    }
    await customer.update(data);
    await AuditService.logUpdate(MODULES.CUSTOMER_LOGS, "Customer", customerId, { userId, changes, ipAddress });
    return customer;
  }

  static async deleteCustomer(customerId, userId, ipAddress) {
    const customer = await Customer.findByPk(customerId);
    if (!customer) throw new CustomerLogError("Customer not found", 404);
    // Same rule as the UI: activity history is kept, so customers with logs cannot be deleted.
    if (await CustomerLog.count({ where: { customerId } })) {
      throw new CustomerLogError("Customers with activity logs cannot be deleted", 409);
    }
    await customer.destroy();
    await AuditService.logDelete(MODULES.CUSTOMER_LOGS, "Customer", customerId, {
      userId, description: `Deleted customer: ${customer.name}`, ipAddress
    });
    return { success: true, message: "Customer deleted successfully" };
  }

  static async searchCustomers(query, limit = 20) {
    return Customer.findAll({
      where: {
        status: "ACTIVE",
        [Op.or]: [
          { name: { [Op.like]: `%${query}%` } },
          { email: { [Op.like]: `%${query}%` } },
          { contactNumber: { [Op.like]: `%${query}%` } }
        ]
      },
      order: [["name", "ASC"]],
      limit
    });
  }

  // For integration: other modules call this to get customer loyalty data
  static async getCustomerLoyalty(customerId) {
    const customer = await Customer.findByPk(customerId, { include: [LoyaltyRecord] });
    if (!customer) throw new CustomerLogError("Customer not found", 404);
    const netPurchases = await netPurchaseCount(customerId);
    return {
      customerId: customer.customerId,
      loyaltyPoints: customer.LoyaltyRecord ? customer.LoyaltyRecord.pointsBalance : netPurchases,
      tier: customer.LoyaltyRecord?.tier || tierFor(netPurchases),
      totalPurchases: netPurchases,
      totalSpent: Number(customer.totalSpent || 0),
      registrationDate: customer.createdAt
    };
  }

  // Manual points adjustment. The first adjustment creates the balance from the points already earned.
  static async addLoyaltyPoints(customerId, points) {
    const customer = await Customer.findByPk(customerId);
    if (!customer) throw new CustomerLogError("Customer not found", 404);
    const netPurchases = await netPurchaseCount(customerId);
    const [loyalty] = await LoyaltyRecord.findOrCreate({
      where: { customerId },
      defaults: { pointsBalance: netPurchases, tier: tierFor(netPurchases) }
    });
    await loyalty.update({ pointsBalance: loyalty.pointsBalance + Number(points) });
    return this.getCustomerLoyalty(customerId);
  }
}
