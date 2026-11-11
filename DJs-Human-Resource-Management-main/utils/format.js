// Local-date helpers (avoid UTC shifting DATEONLY values).
export const localDateISO = (date = new Date()) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const startOfMonthISO = (date = new Date()) =>
  localDateISO(new Date(date.getFullYear(), date.getMonth(), 1));

export const endOfMonthISO = (date = new Date()) =>
  localDateISO(new Date(date.getFullYear(), date.getMonth() + 1, 0));

export const formatDate = (value) => {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
};

export const formatTime = (value) => {
  if (!value) return "—";
  const [h, m] = String(value).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(value);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`;
};

export const formatDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric"
  })} ${d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}`;
};

export const formatMoney = (value) => {
  const n = Number(value || 0);
  return `₱${(Number.isFinite(n) ? n : 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
};

export const formatNumber = (value) => Number(value || 0).toLocaleString("en-PH");
