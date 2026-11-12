import { urls } from "../routes/urls.js";
import { getPayrollOverview } from "../services/payrollService.js";

// HR's payroll as Accounting sees it (read-only): HR computes it and marks it Paid, then posts it here.
export const payrollPage = async (req, res) => {
  res.render("payroll", {
    title: "Payroll",
    activeMenu: "payroll",
    urls,
    overview: await getPayrollOverview(),
    hrPayrollUrl: `${(process.env.ERP_URL_HR || "http://localhost:3002").replace(/\/+$/, "")}/payroll`
  });
};
