import { Employee, Department } from "../models/index.js";

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Every table shows PAGE_SIZE rows per page (views/partials/pagination.xian draws the buttons).
export const PAGE_SIZE = 9;

/**
 * Page links for `count` rows. Keeps the current filters (every query value except `page`).
 * Returns the page to show (clamped) and what the pagination partial needs.
 */
export const pageInfo = (req, count, size = PAGE_SIZE) => {
  const totalPages = Math.max(1, Math.ceil(count / size));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== "page" && typeof value === "string" && value !== "") params.set(key, value);
  }
  const href = (n) => {
    const q = new URLSearchParams(params);
    if (n > 1) q.set("page", String(n));
    const s = q.toString();
    return `${req.baseUrl}${req.path}${s ? `?${s}` : ""}`;
  };
  const offset = (page - 1) * size;
  return {
    page,
    totalPages,
    count,
    offset,
    limit: size,
    from: count ? offset + 1 : 0,
    to: Math.min(offset + size, count),
    hasPrev: page > 1,
    hasNext: page < totalPages,
    prevHref: href(page - 1),
    nextHref: href(page + 1),
    pages: Array.from({ length: totalPages }, (_, i) => ({ number: i + 1, current: i + 1 === page, href: href(i + 1) }))
  };
};

/** Slices an array that is already loaded: { rows, pagination }. */
export const paginate = (req, items, size = PAGE_SIZE) => {
  const pagination = pageInfo(req, items.length, size);
  return { rows: items.slice(pagination.offset, pagination.offset + size), pagination };
};

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
