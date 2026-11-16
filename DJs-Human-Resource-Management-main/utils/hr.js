export const LEAVE_TYPES = [
  "Vacation",
  "Sick",
  "Maternity",
  "Paternity",
  "Emergency",
  "Unpaid"
];

export const EMPLOYMENT_STATUSES = ["Active", "On Leave", "Resigned"];

export const ATTENDANCE_STATUSES = ["Present", "Late", "Absent", "Half Day"];

// Annual leave allocation (days) used for balance tracking.
export const LEAVE_ALLOCATION = {
  Vacation: 15,
  Sick: 15,
  Maternity: 105,
  Paternity: 7,
  Emergency: 5,
  Unpaid: 0
};

export const OFFICE_START_MINUTES = 8 * 60; // 08:00

export const timeToMinutes = (value) => {
  if (!value) return null;
  const [h, m] = String(value).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

export const lateMinutesFor = (checkIn) => {
  const minutes = timeToMinutes(checkIn);
  if (minutes === null) return 0;
  return Math.max(0, minutes - OFFICE_START_MINUTES);
};

// Weekly rest days (0 = Sunday ... 6 = Saturday). Default Sunday, matching the 26 working days a month
// payroll uses. Set HR_REST_DAYS in .env to change it (for example HR_REST_DAYS=0,6, or empty for none).
export const REST_DAYS = new Set(
  String(process.env.HR_REST_DAYS ?? "0")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => /^[0-6]$/.test(d))
    .map(Number)
);

export const isRestDay = (isoDate) => REST_DAYS.has(new Date(`${String(isoDate).slice(0, 10)}T12:00:00`).getDay());

// Every YYYY-MM-DD from startDate to endDate (inclusive).
export function* eachDay(startDate, endDate) {
  const d = new Date(`${String(startDate).slice(0, 10)}T12:00:00`);
  const end = new Date(`${String(endDate).slice(0, 10)}T12:00:00`);
  while (d <= end) {
    yield `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    d.setDate(d.getDate() + 1);
  }
}

// Working days a leave covers: rest days are not counted (a Saturday-to-Monday leave is 2 days).
export const leaveDays = (startDate, endDate) => {
  if (!isValidDate(String(startDate).slice(0, 10)) || !isValidDate(String(endDate).slice(0, 10))) return 0;
  let days = 0;
  for (const day of eachDay(startDate, endDate)) if (!isRestDay(day)) days += 1;
  return days;
};

export const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
