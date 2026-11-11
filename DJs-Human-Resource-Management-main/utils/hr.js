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

export const leaveDays = (startDate, endDate) => {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
};

export const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
