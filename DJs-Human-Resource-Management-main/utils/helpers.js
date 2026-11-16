import { Employee, Department } from "../models/index.js";

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const parseMoney = (value) => {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export const parseId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const generateEmployeeCode = async () => {
  const last = await Employee.findOne({ order: [["id", "DESC"]] });
  let next = (last ? last.id : 0) + 1;
  let code = `EMP-${String(next).padStart(4, "0")}`;
  while (await Employee.findOne({ where: { employeeCode: code } })) {
    next += 1;
    code = `EMP-${String(next).padStart(4, "0")}`;
  }
  return code;
};

// The employee record an account may see. Only the link an administrator made (users.employeeId)
// counts; a matching email is never enough, because anyone can register with any email.
export const findEmployeeForUser = async (user) => {
  if (!user || !user.employeeId) return null;
  return Employee.findByPk(user.employeeId);
};

export const getDepartmentNames = async () => {
  const [departments, distinct] = await Promise.all([
    Department.findAll({ order: [["name", "ASC"]] }),
    Employee.findAll({ attributes: ["department"], group: ["department"], raw: true })
  ]);

  const names = new Set(departments.map((d) => d.name).filter(Boolean));
  distinct.forEach((row) => row.department && names.add(row.department));
  return [...names].sort((a, b) => a.localeCompare(b));
};
