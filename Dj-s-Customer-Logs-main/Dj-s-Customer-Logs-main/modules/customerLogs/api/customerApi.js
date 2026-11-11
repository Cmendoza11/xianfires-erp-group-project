/*
    Customer Logs Module - REST API Endpoints
    Used for inter-module communication and external integrations
*/

import express from "express";
import { CustomerService } from "../services/CustomerService.js";
import { ApiResponse, sendApiResponse } from "../../../core/ApiResponse.js";
import { HTTP_STATUS } from "../../../config/constants.js";

const router = express.Router();

// ==================== PUBLIC API (for other modules) ====================

/**
 * GET /api/customers/loyalty/:customerId
 * Get customer loyalty information
 * Called by: POS (after sale), Accounting (for reporting)
 */
router.get("/loyalty/:customerId", async (req, res) => {
  try {
    const loyalty = await CustomerService.getCustomerLoyalty(req.params.customerId);
    sendApiResponse(res, ApiResponse.success(loyalty, "Loyalty info retrieved"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * POST /api/customers/:customerId/loyalty/add
 * Add loyalty points to a customer
 * Called by: POS module after each transaction
 */
router.post("/:customerId/loyalty/add", async (req, res) => {
  try {
    const { points, reason } = req.body;
    
    if (!points || points < 0) {
      return sendApiResponse(res, ApiResponse.badRequest("Valid points required"));
    }

    const result = await CustomerService.addLoyaltyPoints(
      req.params.customerId,
      points,
      reason
    );

    sendApiResponse(res, ApiResponse.success(result, "Loyalty points added"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * GET /api/customers/search
 * Search customers by name, email, or contact
 * Called by: Any module needing customer lookup
 */
router.get("/search", async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.length < 2) {
      return sendApiResponse(res, ApiResponse.badRequest("Query must be at least 2 characters"));
    }

    const results = await CustomerService.searchCustomers(q, parseInt(limit));
    sendApiResponse(res, ApiResponse.success(results, "Search results"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * GET /api/customers/:customerId
 * Get full customer details
 * Called by: Any module needing customer info
 */
router.get("/:customerId", async (req, res) => {
  try {
    const customer = await CustomerService.getCustomerById(req.params.customerId);
    
    if (!customer) {
      return sendApiResponse(res, ApiResponse.notFound("Customer not found"));
    }

    sendApiResponse(res, ApiResponse.success(customer));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

// ==================== ADMIN API (with auth required) ====================

/**
 * POST /api/customers
 * Create new customer
 */
router.post("/", async (req, res) => {
  try {
    const { name, contactNumber } = req.body;

    if (!name || !contactNumber) {
      return sendApiResponse(res, ApiResponse.badRequest("Name and contact number required"));
    }

    const customer = await CustomerService.createCustomer(req.body, null, req.ip);

    sendApiResponse(res, ApiResponse.created(customer, "Customer created successfully"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * PUT /api/customers/:customerId
 * Update customer
 */
router.put("/:customerId", async (req, res) => {
  try {
    const customer = await CustomerService.updateCustomer(
      req.params.customerId,
      req.body,
      req.user?.userId,
      req.ip
    );

    sendApiResponse(res, ApiResponse.success(customer, "Customer updated"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * DELETE /api/customers/:customerId
 * Delete customer
 */
router.delete("/:customerId", async (req, res) => {
  try {
    const result = await CustomerService.deleteCustomer(
      req.params.customerId,
      req.user?.userId,
      req.ip
    );

    sendApiResponse(res, ApiResponse.success(result, "Customer deleted"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * GET /api/customers
 * List all customers with pagination
 */
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await CustomerService.getAllCustomers(parseInt(limit), offset);
    sendApiResponse(res, ApiResponse.success(result));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

export default router;
