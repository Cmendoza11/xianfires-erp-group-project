import { sequelize } from "./db.js";
import User from "./userModel.js";
import Employee from "./EmployeeModel.js";
import Department from "./DepartmentModel.js";
import Attendance from "./AttendanceModel.js";
import Leave from "./LeaveModel.js";
import Payroll from "./PayrollModel.js";

// Accounts <-> employee records
User.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });
Employee.hasOne(User, { foreignKey: "employeeId", as: "account" });

// Department head
Department.belongsTo(Employee, { foreignKey: "headId", as: "head", onDelete: "SET NULL" });
Employee.hasMany(Department, { foreignKey: "headId", as: "headedDepartments" });

// Attendance
Employee.hasMany(Attendance, { foreignKey: "employeeId", as: "attendances", onDelete: "CASCADE" });
Attendance.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });

// Leaves
Employee.hasMany(Leave, { foreignKey: "employeeId", as: "leaves", onDelete: "CASCADE" });
Leave.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });
Leave.belongsTo(User, { foreignKey: "reviewedBy", as: "reviewer", onDelete: "SET NULL" });

// Payroll
Employee.hasMany(Payroll, { foreignKey: "employeeId", as: "payrolls", onDelete: "CASCADE" });
Payroll.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });
Payroll.belongsTo(User, { foreignKey: "processedBy", as: "processor", onDelete: "SET NULL" });

// Adds columns that exist on a model but not yet in its table (e.g. the payroll accounting fields).
const addMissingColumns = async () => {
  const queryInterface = sequelize.getQueryInterface();
  for (const model of Object.values(sequelize.models)) {
    const table = model.getTableName();
    const existing = await queryInterface.describeTable(table);
    for (const [name, attribute] of Object.entries(model.rawAttributes)) {
      const column = attribute.field || name;
      if (existing[column] || attribute.type?.key === "VIRTUAL") continue;
      const { type, allowNull, defaultValue } = attribute;
      // NOT NULL only when a default can fill existing rows.
      await queryInterface.addColumn(table, column, {
        type,
        allowNull: allowNull !== false || defaultValue === undefined,
        defaultValue
      });
      console.log(`  ➕ Added ${table}.${column}`);
    }
  }
};

export const syncDatabase = async () => {
  await sequelize.authenticate();
  // Never force/alter: only creates missing tables (existing data is preserved).
  await sequelize.sync();
  await addMissingColumns();
};

export { sequelize, User, Employee, Department, Attendance, Leave, Payroll };
