/*
    ERP System - Standardized API Response Format
    All API endpoints return this format for consistency
*/

export class ApiResponse {
  constructor(statusCode, data, message, success = true) {
    this.statusCode = statusCode;
    this.data = data;
    this.message = message;
    this.success = success;
    this.timestamp = new Date().toISOString();
  }

  static success(data, message = "Success", statusCode = 200) {
    return new ApiResponse(statusCode, data, message, true);
  }

  static error(message, statusCode = 500, data = null) {
    return new ApiResponse(statusCode, data, message, false);
  }

  static created(data, message = "Created successfully") {
    return new ApiResponse(201, data, message, true);
  }

  static badRequest(message, data = null) {
    return new ApiResponse(400, data, message, false);
  }

  static unauthorized(message = "Unauthorized") {
    return new ApiResponse(401, null, message, false);
  }

  static forbidden(message = "Forbidden") {
    return new ApiResponse(403, null, message, false);
  }

  static notFound(message = "Not found") {
    return new ApiResponse(404, null, message, false);
  }
}

export const sendApiResponse = (res, response) => {
  return res.status(response.statusCode).json(response);
};
