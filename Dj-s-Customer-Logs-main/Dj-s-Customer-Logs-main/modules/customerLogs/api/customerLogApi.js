/*
    Customer Logs Module - Customer Log API
    Endpoints for recording and retrieving customer interactions
*/

import express from "express";
import { CustomerLogService } from "../services/CustomerLogService.js";
import { ApiResponse, sendApiResponse } from "../../../core/ApiResponse.js";
import { HTTP_STATUS } from "../../../config/constants.js";

const router = express.Router();

/**
 * POST /api/customer-logs
 * Record a new customer log entry
 * Called by: UI or other modules
 */
router.post("/", async (req, res) => {
  try {
    // Accepts the UI field names (activityType, transactionReference) or the older API ones (logType, referenceId).
    const { customerId } = req.body;

    if (!customerId || !(req.body.activityType || req.body.logType)) {
      return sendApiResponse(res, ApiResponse.badRequest("customerId and activityType required"));
    }

    const { log, duplicate } = await CustomerLogService.recordLog(customerId, req.body, null, req.ip);

    sendApiResponse(res, duplicate
      ? ApiResponse.success({ log, duplicate: true }, "Already recorded")
      : ApiResponse.created({ log, duplicate: false }, "Log recorded successfully"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * GET /api/customer-logs/:customerId
 * Get customer's complete history
 */
router.get("/:customerId", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await CustomerLogService.getCustomerHistory(
      req.params.customerId,
      parseInt(limit),
      offset
    );

    sendApiResponse(res, ApiResponse.success(result, "Customer history retrieved"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * GET /api/customer-logs/type/:logType
 * Get all logs of a specific type
 */
router.get("/type/:logType", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await CustomerLogService.getLogsbyType(
      req.params.logType,
      parseInt(limit),
      offset
    );

    sendApiResponse(res, ApiResponse.success(result));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * GET /api/customer-logs/module/:sourceModule
 * Get all logs from a specific module (e.g., from POS)
 */
router.get("/module/:sourceModule", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await CustomerLogService.getLogsbyModule(
      req.params.sourceModule,
      parseInt(limit),
      offset
    );

    sendApiResponse(res, ApiResponse.success(result));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, error.status || HTTP_STATUS.SERVER_ERROR));
  }
});

export default router;
