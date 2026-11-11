/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { sequelize } from './db.js';
import { User } from './userModel.js';
import { Supplier } from './Supplier.js';
import { Department } from './Department.js';
import { SupplierProduct } from './SupplierProduct.js';
import { PurchaseRequest } from './PurchaseRequest.js';
import { PurchaseRequestItem } from './PurchaseRequestItem.js';
import { PurchaseOrder } from './PurchaseOrder.js';
import { PurchaseOrderItem } from './PurchaseOrderItem.js';
import { GoodsReceipt } from './GoodsReceipt.js';
import { GoodsReceiptItem } from './GoodsReceiptItem.js';
import { SupplierReturn } from './SupplierReturn.js';
import { SupplierReturnItem } from './SupplierReturnItem.js';
import { SupplierInvoice } from './SupplierInvoice.js';
import { SupplierActivityLog } from './SupplierActivityLog.js';

// Backward compatibility aliases
export { Product } from './Product.js';
export { PurchasedOrder } from './Purchasedorder.js';

// --- Associations ---

// 1. Supplier <-> SupplierProduct
Supplier.hasMany(SupplierProduct, { foreignKey: 'supplierId', as: 'Products' });
SupplierProduct.belongsTo(Supplier, { foreignKey: 'supplierId' });

// 2. Department <-> PurchaseRequest
Department.hasMany(PurchaseRequest, { foreignKey: 'departmentId', as: 'PurchaseRequests' });
PurchaseRequest.belongsTo(Department, { foreignKey: 'departmentId' });

// 3. User <-> PurchaseRequest
User.hasMany(PurchaseRequest, { foreignKey: 'requestedBy', as: 'RequestedPRs' });
PurchaseRequest.belongsTo(User, { foreignKey: 'requestedBy', as: 'Requester' });
PurchaseRequest.belongsTo(User, { foreignKey: 'approvedBy', as: 'Approver' });

// 4. PurchaseRequest <-> PurchaseRequestItem
PurchaseRequest.hasMany(PurchaseRequestItem, { foreignKey: 'purchaseRequestId', as: 'Items' });
PurchaseRequestItem.belongsTo(PurchaseRequest, { foreignKey: 'purchaseRequestId' });

// 5. PurchaseRequest <-> PurchaseOrder
PurchaseRequest.hasOne(PurchaseOrder, { foreignKey: 'purchaseRequestId', as: 'PurchaseOrder' });
PurchaseOrder.belongsTo(PurchaseRequest, { foreignKey: 'purchaseRequestId' });

// 6. Supplier <-> PurchaseOrder
Supplier.hasMany(PurchaseOrder, { foreignKey: 'supplierId', as: 'PurchaseOrders' });
PurchaseOrder.belongsTo(Supplier, { foreignKey: 'supplierId' });

// 7. Department <-> PurchaseOrder
Department.hasMany(PurchaseOrder, { foreignKey: 'departmentId', as: 'PurchaseOrders' });
PurchaseOrder.belongsTo(Department, { foreignKey: 'departmentId' });

// 8. User <-> PurchaseOrder
PurchaseOrder.belongsTo(User, { foreignKey: 'createdBy', as: 'Creator' });
PurchaseOrder.belongsTo(User, { foreignKey: 'approvedBy', as: 'Approver' });

// 9. PurchaseOrder <-> PurchaseOrderItem
PurchaseOrder.hasMany(PurchaseOrderItem, { foreignKey: 'purchaseOrderId', as: 'Items' });
PurchaseOrderItem.belongsTo(PurchaseOrder, { foreignKey: 'purchaseOrderId' });

// 10. PurchaseOrder <-> GoodsReceipt
PurchaseOrder.hasMany(GoodsReceipt, { foreignKey: 'purchaseOrderId', as: 'GoodsReceipts' });
GoodsReceipt.belongsTo(PurchaseOrder, { foreignKey: 'purchaseOrderId' });

// 11. Supplier <-> GoodsReceipt
Supplier.hasMany(GoodsReceipt, { foreignKey: 'supplierId', as: 'GoodsReceipts' });
GoodsReceipt.belongsTo(Supplier, { foreignKey: 'supplierId' });

// 12. User <-> GoodsReceipt
GoodsReceipt.belongsTo(User, { foreignKey: 'receivedBy', as: 'Receiver' });

// 13. GoodsReceipt <-> GoodsReceiptItem
GoodsReceipt.hasMany(GoodsReceiptItem, { foreignKey: 'goodsReceiptId', as: 'Items' });
GoodsReceiptItem.belongsTo(GoodsReceipt, { foreignKey: 'goodsReceiptId' });
GoodsReceiptItem.belongsTo(PurchaseOrderItem, { foreignKey: 'purchaseOrderItemId', as: 'OrderItem' });

// 14. PurchaseOrder / Supplier / GoodsReceipt <-> SupplierReturn
PurchaseOrder.hasMany(SupplierReturn, { foreignKey: 'purchaseOrderId', as: 'Returns' });
SupplierReturn.belongsTo(PurchaseOrder, { foreignKey: 'purchaseOrderId' });

Supplier.hasMany(SupplierReturn, { foreignKey: 'supplierId', as: 'Returns' });
SupplierReturn.belongsTo(Supplier, { foreignKey: 'supplierId' });

GoodsReceipt.hasMany(SupplierReturn, { foreignKey: 'goodsReceiptId', as: 'Returns' });
SupplierReturn.belongsTo(GoodsReceipt, { foreignKey: 'goodsReceiptId' });

SupplierReturn.hasMany(SupplierReturnItem, { foreignKey: 'supplierReturnId', as: 'Items' });
SupplierReturnItem.belongsTo(SupplierReturn, { foreignKey: 'supplierReturnId' });

// 15. PurchaseOrder / Supplier / GoodsReceipt <-> SupplierInvoice
PurchaseOrder.hasMany(SupplierInvoice, { foreignKey: 'purchaseOrderId', as: 'Invoices' });
SupplierInvoice.belongsTo(PurchaseOrder, { foreignKey: 'purchaseOrderId' });

Supplier.hasMany(SupplierInvoice, { foreignKey: 'supplierId', as: 'Invoices' });
SupplierInvoice.belongsTo(Supplier, { foreignKey: 'supplierId' });

GoodsReceipt.hasOne(SupplierInvoice, { foreignKey: 'goodsReceiptId', as: 'Invoice' });
SupplierInvoice.belongsTo(GoodsReceipt, { foreignKey: 'goodsReceiptId' });

// 16. User <-> SupplierActivityLog
User.hasMany(SupplierActivityLog, { foreignKey: 'userId', as: 'ActivityLogs' });
SupplierActivityLog.belongsTo(User, { foreignKey: 'userId' });

export {
  sequelize,
  User,
  Supplier,
  Department,
  SupplierProduct,
  PurchaseRequest,
  PurchaseRequestItem,
  PurchaseOrder,
  PurchaseOrderItem,
  GoodsReceipt,
  GoodsReceiptItem,
  SupplierReturn,
  SupplierReturnItem,
  SupplierInvoice,
  SupplierActivityLog
};
