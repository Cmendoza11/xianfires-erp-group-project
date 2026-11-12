/*
  Payroll from attendance (DTR) and the government contributions.

  Pay for the period
    days paid      Present / Late = 1 day, Half Day = 0.5, Absent = 0, plus approved paid leave days
                   (every type except Unpaid) that have no attendance row
    basic pay      days paid x daily rate (employee's rate per day, or monthly salary / 26)
    overtime       hours worked beyond 8 a day (1 hour lunch taken out of days over 5 hours),
                   paid at the hourly rate (daily rate / 8) x 125%

  Employee share of the contributions (per month; a payroll of 16 days or less takes half)
    SSS            5% of the monthly salary credit (salary to the nearest 500, from 5,000 to 35,000)
    PhilHealth     2.5% of the monthly basic salary (floor 10,000, ceiling 100,000)
    Pag-IBIG       2% of the monthly salary up to 10,000 (1% when the salary is 1,500 or less), so at most 200

  HR can change every amount on the form before saving.
*/
import { Op } from "sequelize";
import { Attendance, Leave } from "../models/index.js";

const WORKING_DAYS_PER_MONTH = 26;
const HOURS_PER_DAY = 8;
const OVERTIME_PREMIUM = 1.25;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

export const dailyRateOf = (employee) =>
  round2(Number(employee.dailyRate) > 0 ? Number(employee.dailyRate) : Number(employee.salary || 0) / WORKING_DAYS_PER_MONTH);
export const hourlyRateOf = (employee) => round2(dailyRateOf(employee) / HOURS_PER_DAY);
const monthlyBasisOf = (employee) =>
  Number(employee.salary) > 0 ? Number(employee.salary) : dailyRateOf(employee) * WORKING_DAYS_PER_MONTH;

/** Monthly employee share of SSS, PhilHealth and Pag-IBIG for a monthly salary. */
export function monthlyContributions(monthly) {
  const salary = Math.max(Number(monthly) || 0, 0);
  if (!salary) return { sss: 0, philhealth: 0, pagibig: 0 };
  const msc = clamp(Math.round(salary / 500) * 500, 5000, 35000);
  return {
    sss: round2(msc * 0.05),
    philhealth: round2(clamp(salary, 10000, 100000) * 0.025),
    pagibig: round2(Math.min(salary, 10000) * (salary <= 1500 ? 0.01 : 0.02))
  };
}

const minutesOf = (time) => {
  const [h, m] = String(time || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

/** Overtime minutes for one attendance row (0 without both times). */
export function overtimeMinutes(row) {
  const start = minutesOf(row.checkIn);
  const end = minutesOf(row.checkOut);
  if (start === null || end === null) return 0;
  let worked = end - start;
  if (worked < 0) worked += 24 * 60; // shift past midnight
  if (worked > 5 * 60) worked -= 60; // lunch break
  return Math.max(worked - HOURS_PER_DAY * 60, 0);
}

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function* daysBetween(from, to) {
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (d <= end) {
    yield isoDay(d);
    d.setDate(d.getDate() + 1);
  }
}

/** Everything the payroll form needs for one employee and period, computed from the DTR. */
export async function computePayroll(employee, periodStart, periodEnd) {
  const dailyRate = dailyRateOf(employee);
  const hourlyRate = hourlyRateOf(employee);
  const rows = await Attendance.findAll({
    where: { employeeId: employee.id, date: { [Op.between]: [periodStart, periodEnd] } },
    raw: true
  });
  const covered = new Set(rows.map((r) => String(r.date)));
  let days = 0;
  let overtimeMin = 0;
  let lateMinutes = 0;
  let absences = 0;
  for (const row of rows) {
    if (row.status === "Present" || row.status === "Late") days += 1;
    else if (row.status === "Half Day") days += 0.5;
    else if (row.status === "Absent") absences += 1;
    if (row.status !== "Absent") overtimeMin += overtimeMinutes(row);
    lateMinutes += Number(row.lateMinutes || 0);
  }

  const leaves = await Leave.findAll({
    where: {
      employeeId: employee.id,
      status: "Approved",
      type: { [Op.ne]: "Unpaid" },
      startDate: { [Op.lte]: periodEnd },
      endDate: { [Op.gte]: periodStart }
    },
    raw: true
  });
  let leaveDays = 0;
  for (const leave of leaves) {
    const from = leave.startDate > periodStart ? leave.startDate : periodStart;
    const to = leave.endDate < periodEnd ? leave.endDate : periodEnd;
    for (const day of daysBetween(String(from), String(to))) {
      if (!covered.has(day)) {
        covered.add(day);
        leaveDays += 1;
      }
    }
  }

  const daysWorked = days + leaveDays;
  const overtimeHours = round2(overtimeMin / 60);
  const periodDays = [...daysBetween(periodStart, periodEnd)].length;
  const share = periodDays <= 16 ? 0.5 : 1; // semi-monthly (kinsenas) or monthly payroll
  const monthly = monthlyContributions(monthlyBasisOf(employee));

  return {
    dailyRate,
    hourlyRate,
    daysWorked,
    leaveDays,
    absences,
    lateMinutes,
    overtimeHours,
    basicSalary: round2(daysWorked * dailyRate),
    overtime: round2(overtimeHours * hourlyRate * OVERTIME_PREMIUM),
    sssDeduction: round2(monthly.sss * share),
    philhealthDeduction: round2(monthly.philhealth * share),
    pagibigDeduction: round2(monthly.pagibig * share),
    attendanceDays: rows.length
  };
}
