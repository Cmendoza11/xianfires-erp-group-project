import { fn, col, Op } from "sequelize";
import { Department, Employee } from "../models/index.js";
import { asyncHandler, parseId } from "../utils/helpers.js";

const nameTaken = async (name, ignoreId = null) => {
  const where = { name };
  if (ignoreId) where.id = { [Op.ne]: ignoreId };
  return Department.findOne({ where });
};

export const departmentList = asyncHandler(async (req, res) => {
  const departments = await Department.findAll({
    include: [{ model: Employee, as: "head", attributes: ["id", "firstName", "lastName"] }],
    order: [["name", "ASC"]]
  });

  const counts = await Employee.findAll({
    attributes: ["department", [fn("COUNT", col("id")), "count"]],
    group: ["department"],
    raw: true
  });
  const countMap = new Map(counts.map((row) => [row.department, Number(row.count)]));

  const employees = await Employee.findAll({
    attributes: ["id", "firstName", "lastName", "department", "position"],
    order: [["lastName", "ASC"]]
  });

  res.render("departments", {
    title: "Departments | DJs HRMS",
    departments: departments.map((d) => ({
      ...d.toJSON(),
      employeeCount: countMap.get(d.name) || 0
    })),
    employees: employees.map((e) => e.toJSON())
  });
});

export const departmentCreate = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const code = String(req.body.code || "").trim() || null;
  const description = String(req.body.description || "").trim() || null;
  const headId = parseId(req.body.headId);

  if (!name) {
    req.flash("error_msg", "Department name is required.");
    return res.redirect("/departments");
  }

  if (await nameTaken(name)) {
    req.flash("error_msg", "A department with that name already exists.");
    return res.redirect("/departments");
  }

  if (headId && !(await Employee.findByPk(headId))) {
    req.flash("error_msg", "Selected department head was not found.");
    return res.redirect("/departments");
  }

  await Department.create({ name, code, description, headId });
  req.flash("success_msg", `Department "${name}" created.`);
  res.redirect("/departments");
});

export const departmentEditPage = asyncHandler(async (req, res) => {
  const department = await Department.findByPk(req.params.id);

  if (!department) {
    req.flash("error_msg", "Department not found.");
    return res.redirect("/departments");
  }

  const employees = await Employee.findAll({
    attributes: ["id", "firstName", "lastName", "department", "position"],
    order: [["lastName", "ASC"]]
  });

  res.render("department-edit", {
    title: "Edit Department | DJs HRMS",
    department: department.toJSON(),
    employees: employees.map((e) => e.toJSON())
  });
});

export const departmentUpdate = asyncHandler(async (req, res) => {
  const department = await Department.findByPk(req.params.id);

  if (!department) {
    req.flash("error_msg", "Department not found.");
    return res.redirect("/departments");
  }

  const name = String(req.body.name || "").trim();
  const code = String(req.body.code || "").trim() || null;
  const description = String(req.body.description || "").trim() || null;
  const headId = parseId(req.body.headId);

  if (!name) {
    req.flash("error_msg", "Department name is required.");
    return res.redirect(`/departments/${department.id}/edit`);
  }

  if (await nameTaken(name, department.id)) {
    req.flash("error_msg", "Another department already uses that name.");
    return res.redirect(`/departments/${department.id}/edit`);
  }

  if (headId && !(await Employee.findByPk(headId))) {
    req.flash("error_msg", "Selected department head was not found.");
    return res.redirect(`/departments/${department.id}/edit`);
  }

  const previousName = department.name;
  await department.update({ name, code, description, headId });

  // Keep employee department assignments in sync on rename.
  if (previousName !== name) {
    await Employee.update({ department: name }, { where: { department: previousName } });
  }

  req.flash("success_msg", "Department updated.");
  res.redirect("/departments");
});

export const departmentAssignEmployee = asyncHandler(async (req, res) => {
  const department = await Department.findByPk(req.params.id);

  if (!department) {
    req.flash("error_msg", "Department not found.");
    return res.redirect("/departments");
  }

  const employee = await Employee.findByPk(parseId(req.body.employeeId));
  if (!employee) {
    req.flash("error_msg", "Select a valid employee.");
    return res.redirect(`/departments/${department.id}/edit`);
  }

  await employee.update({ department: department.name });
  req.flash(
    "success_msg",
    `${employee.firstName} ${employee.lastName} was assigned to ${department.name}.`
  );
  res.redirect(`/departments/${department.id}/edit`);
});

export const departmentDelete = asyncHandler(async (req, res) => {
  const department = await Department.findByPk(req.params.id);

  if (!department) {
    req.flash("error_msg", "Department not found.");
    return res.redirect("/departments");
  }

  const assigned = await Employee.count({ where: { department: department.name } });
  if (assigned > 0) {
    req.flash(
      "error_msg",
      `Cannot delete "${department.name}" while ${assigned} employee(s) are assigned. Reassign them first.`
    );
    return res.redirect("/departments");
  }

  await department.destroy();
  req.flash("success_msg", "Department deleted.");
  res.redirect("/departments");
});
