/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
// Backward-compatibility wrapper delegating to purchaseOrderController
import { purchaseOrderController } from './purchaseOrderController.js';

export const getPurchaseHistory = (req, res) => purchaseOrderController.index(req, res);
export const showAddOrderPage = (req, res) => purchaseOrderController.showCreateForm(req, res);
export const insertOrder = (req, res) => purchaseOrderController.store(req, res);
export const getOrderDetails = (req, res) => purchaseOrderController.show(req, res);
