# Module Template - Copy this to create new modules

Use this template when adding new modules (POS, Inventory, Accounting, etc.)

## Directory Structure

```
modules/
└── newModule/
    ├── models/
    │   ├── NewModel.js
    │   └── AnotherModel.js
    │
    ├── services/
    │   ├── NewService.js
    │   └── AnotherService.js
    │
    ├── api/
    │   ├── newApi.js
    │   └── anotherApi.js
    │
    ├── controllers/             (Optional: for UI)
    │   └── newController.js
    │
    └── README.md                (Module documentation)
```

## 1. Create Model

File: `modules/newModule/models/NewModel.js`

```javascript
/*
    NewModule - New Model
    Description of what this model represents
*/

import { DataTypes } from "sequelize";
import { sequelize } from "../../../config/database.js";

export const NewModel = sequelize.define("NewModel", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // ... other fields
}, {
  timestamps: true,
  indexes: [
    { fields: ["name"] }
  ]
});
```

## 2. Create Service

File: `modules/newModule/services/NewService.js`

```javascript
/*
    NewModule - New Service
    Business logic for NewModel
*/

import { NewModel } from "../models/NewModel.js";
import { AuditService } from "../../../core/AuditService.js";
import { MODULES } from "../../../config/constants.js";

export class NewService {

  static async create(data, userId, ipAddress) {
    try {
      const item = await NewModel.create(data);

      await AuditService.logCreate(
        MODULES.NEW_MODULE,
        "NewModel",
        item.id,
        { userId, ipAddress }
      );

      return item;
    } catch (error) {
      throw new Error(`Failed to create: ${error.message}`);
    }
  }

  static async getById(id) {
    try {
      return await NewModel.findByPk(id);
    } catch (error) {
      throw new Error(`Failed to fetch: ${error.message}`);
    }
  }

  static async getAll(limit = 50, offset = 0) {
    try {
      const { count, rows } = await NewModel.findAndCountAll({
        limit,
        offset,
        order: [["createdAt", "DESC"]]
      });
      return { total: count, items: rows };
    } catch (error) {
      throw new Error(`Failed to fetch items: ${error.message}`);
    }
  }

  static async update(id, data, userId, ipAddress) {
    try {
      const item = await NewModel.findByPk(id);
      if (!item) throw new Error("Item not found");

      await item.update(data);

      await AuditService.logUpdate(
        MODULES.NEW_MODULE,
        "NewModel",
        id,
        { userId, ipAddress }
      );

      return item;
    } catch (error) {
      throw new Error(`Failed to update: ${error.message}`);
    }
  }

  static async delete(id, userId, ipAddress) {
    try {
      const item = await NewModel.findByPk(id);
      if (!item) throw new Error("Item not found");

      await item.destroy();

      await AuditService.logDelete(
        MODULES.NEW_MODULE,
        "NewModel",
        id,
        { userId, ipAddress }
      );

      return { success: true };
    } catch (error) {
      throw new Error(`Failed to delete: ${error.message}`);
    }
  }
}
```

## 3. Create API Routes

File: `modules/newModule/api/newApi.js`

```javascript
/*
    NewModule - API Routes
    REST endpoints for integration with other modules
*/

import express from "express";
import { NewService } from "../services/NewService.js";
import { ApiResponse, sendApiResponse } from "../../../core/ApiResponse.js";
import { HTTP_STATUS } from "../../../config/constants.js";

const router = express.Router();

/**
 * GET /api/new-resource
 * List all items
 */
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await NewService.getAll(parseInt(limit), offset);
    sendApiResponse(res, ApiResponse.success(result));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * POST /api/new-resource
 * Create new item
 */
router.post("/", async (req, res) => {
  try {
    const item = await NewService.create(
      req.body,
      req.user?.userId,
      req.ip
    );
    sendApiResponse(res, ApiResponse.created(item, "Created successfully"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * GET /api/new-resource/:id
 * Get single item
 */
router.get("/:id", async (req, res) => {
  try {
    const item = await NewService.getById(req.params.id);
    if (!item) {
      return sendApiResponse(res, ApiResponse.notFound("Item not found"));
    }
    sendApiResponse(res, ApiResponse.success(item));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * PUT /api/new-resource/:id
 * Update item
 */
router.put("/:id", async (req, res) => {
  try {
    const item = await NewService.update(
      req.params.id,
      req.body,
      req.user?.userId,
      req.ip
    );
    sendApiResponse(res, ApiResponse.success(item, "Updated successfully"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, HTTP_STATUS.SERVER_ERROR));
  }
});

/**
 * DELETE /api/new-resource/:id
 * Delete item
 */
router.delete("/:id", async (req, res) => {
  try {
    const result = await NewService.delete(
      req.params.id,
      req.user?.userId,
      req.ip
    );
    sendApiResponse(res, ApiResponse.success(result, "Deleted successfully"));
  } catch (error) {
    sendApiResponse(res, ApiResponse.error(error.message, HTTP_STATUS.SERVER_ERROR));
  }
});

export default router;
```

## 4. Register in Main App

File: `index.js`

```javascript
import newApi from "./modules/newModule/api/newApi.js";

// Add after other API routes
app.use("/api/new-resource", newApi);
```

## 5. Add to Constants

File: `config/constants.js`

```javascript
export const MODULES = {
  CUSTOMER_LOGS: "customerLogs",
  POS: "pos",
  INVENTORY: "inventory",
  ACCOUNTING: "accounting",
  HR: "hr",
  PAYROLL: "payroll",
  SUPPLIER: "supplier",
  NEW_MODULE: "newModule"  // Add this
};
```

## 6. Module Documentation

File: `modules/newModule/README.md`

```markdown
# NewModule

## Overview
Description of what this module does.

## Models
- NewModel - description
- AnotherModel - description

## APIs
- GET /api/new-resource - list all
- POST /api/new-resource - create new
- GET /api/new-resource/:id - get one
- PUT /api/new-resource/:id - update
- DELETE /api/new-resource/:id - delete

## Integration with Other Modules
How this module integrates with customerLogs or other modules.

Example:
```javascript
// When creating a new item, notify customerLogs
eventEmitter.emit("newModule.created", { itemId, data });
```

## Events This Module Emits
- `newModule.created` - when item is created
- `newModule.updated` - when item is updated
- `newModule.deleted` - when item is deleted

## Events This Module Listens To
- `customerLogs.purchase` - when a purchase is recorded
```

## Integration Examples

### 1. When Module Needs Customer Data
```javascript
// In NewModule service
import { CustomerService } from "../../customerLogs/services/CustomerService.js";

export class NewService {
  static async createWithCustomer(data, customerId) {
    const customer = await CustomerService.getCustomerById(customerId);
    
    // Use customer data
    const item = await NewModel.create({
      ...data,
      customerName: customer.name
    });
    
    return item;
  }
}
```

### 2. Emit Events for Other Modules
```javascript
// In NewModule service
import eventEmitter from "../../../core/EventEmitter.js";

export class NewService {
  static async create(data, userId, ipAddress) {
    const item = await NewModel.create(data);
    
    // Notify other modules
    eventEmitter.emit("newModule.created", {
      id: item.id,
      type: "NewModel",
      data: item
    });
    
    return item;
  }
}
```

### 3. Listen to Events from Other Modules
```javascript
// In NewModule service setup
import eventEmitter from "../../../core/EventEmitter.js";
import { NewService } from "./NewService.js";

eventEmitter.on("customerLogs.purchase", async (data) => {
  // When customer makes purchase, do something
  await NewService.recordMetric(data);
});
```

### 4. Call APIs from Other Modules

```javascript
// In NewModule service
export class NewService {
  static async syncWithCustomerLogs(data) {
    try {
      // Make API call to customerLogs
      const response = await fetch(
        `http://localhost:8000/api/customers/${data.customerId}`,
        { method: "GET" }
      );
      
      const customerData = await response.json();
      
      // Use customer data
      return customerData;
    } catch (error) {
      console.error("Failed to sync with customerLogs:", error);
    }
  }
}
```

## Testing

### Unit Tests
```javascript
// test/NewService.test.js
import { NewService } from "../modules/newModule/services/NewService.js";

describe("NewService", () => {
  it("should create item", async () => {
    const item = await NewService.create(
      { name: "Test" },
      "userId",
      "127.0.0.1"
    );
    expect(item).toBeDefined();
    expect(item.id).toBeDefined();
  });
});
```

### API Tests
```bash
# Create
curl -X POST http://localhost:8000/api/new-resource \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Item"}'

# Read
curl http://localhost:8000/api/new-resource/[id]

# Update
curl -X PUT http://localhost:8000/api/new-resource/[id] \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Name"}'

# Delete
curl -X DELETE http://localhost:8000/api/new-resource/[id]
```

## Checklist for New Module

- [ ] Create models in `models/`
- [ ] Create services in `services/`
- [ ] Create API endpoints in `api/`
- [ ] Add module to `config/constants.js`
- [ ] Register API in `index.js`
- [ ] Create README.md
- [ ] Add audit logging to services
- [ ] Test all endpoints
- [ ] Document event emissions
- [ ] Document event subscriptions
- [ ] Add integration with other modules if needed

---

Once complete, update the main ARCHITECTURE.md to document this new module.
