import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// One notification for one user account (the bell and /notifications). Made by services/notify.js
// when something happens (leave filed/decided, new employee, payslip ready, password request, ...).
// readAt null = unread. Users delete their own notifications.
const Notification = sequelize.define(
  "Notification",
  {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "general" },
    title: { type: DataTypes.STRING(200), allowNull: false },
    detail: { type: DataTypes.STRING(255), allowNull: true },
    href: { type: DataTypes.STRING(255), allowNull: true },
    icon: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "i-bell" },
    tone: { type: DataTypes.STRING(12), allowNull: false, defaultValue: "yellow" }, // yellow | green | blue | orange | red
    readAt: { type: DataTypes.DATE, allowNull: true }
  },
  { tableName: "hr_notifications", indexes: [{ fields: ["userId", "readAt"] }] }
);

export default Notification;
