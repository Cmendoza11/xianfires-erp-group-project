/*
    ERP System - Audit Service
    Centralizes audit logging logic
*/

import { logAudit } from "../models/AuditLog.js";
import { AUDIT_ACTIONS, MODULES } from "../config/constants.js";

export class AuditService {
  static async log(module, action, entityType, entityId, { userId = null, changes = null, description = null, ipAddress = null } = {}) {
    try {
      await logAudit({
        module,
        action,
        entityType,
        entityId,
        userId,
        changes,
        description,
        ipAddress
      });
    } catch (error) {
      console.error("❌ Audit logging failed:", error);
    }
  }

  static async logCreate(module, entityType, entityId, { userId, description = null, ipAddress = null } = {}) {
    await this.log(module, AUDIT_ACTIONS.CREATE, entityType, entityId, { userId, description, ipAddress });
  }

  static async logUpdate(module, entityType, entityId, { userId, changes = null, description = null, ipAddress = null } = {}) {
    await this.log(module, AUDIT_ACTIONS.UPDATE, entityType, entityId, { userId, changes, description, ipAddress });
  }

  static async logDelete(module, entityType, entityId, { userId, description = null, ipAddress = null } = {}) {
    await this.log(module, AUDIT_ACTIONS.DELETE, entityType, entityId, { userId, description, ipAddress });
  }

  static async logView(module, entityType, entityId, { userId, description = null, ipAddress = null } = {}) {
    await this.log(module, AUDIT_ACTIONS.VIEW, entityType, entityId, { userId, description, ipAddress });
  }
}
