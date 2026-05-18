const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Kolkata";

function getDateTimeParts(value, timeZone = APP_TIME_ZONE) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatDateTimeParts(value, timeZone = APP_TIME_ZONE) {
  const byType = getDateTimeParts(value, timeZone);
  if (!byType) {
    return { date: "", time: "" };
  }

  return {
    date: `${byType.year}-${byType.month}-${byType.day}`,
    time: `${byType.hour}:${byType.minute}`
  };
}

function formatDateString(value, timeZone = APP_TIME_ZONE) {
  return formatDateTimeParts(value, timeZone).date;
}

function formatTimeString(value, timeZone = APP_TIME_ZONE) {
  return formatDateTimeParts(value, timeZone).time;
}

function formatTimeOnlyString(value) {
  if (!value) return "";
  if (!(value instanceof Date)) return value.toString();

  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function addDaysToDateString(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function getTodayDateString(timeZone = APP_TIME_ZONE) {
  return formatDateString(new Date(), timeZone);
}

function getTomorrowDateString(timeZone = APP_TIME_ZONE) {
  return addDaysToDateString(getTodayDateString(timeZone), 1);
}

function getDayOfWeekFromDateString(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

function toDateOnly(dateString) {
  if (!dateString) return null;
  return new Date(`${dateString}T00:00:00.000Z`);
}

module.exports = {
  APP_TIME_ZONE,
  formatDateTimeParts,
  formatDateString,
  formatTimeString,
  formatTimeOnlyString,
  getTodayDateString,
  getTomorrowDateString,
  getDayOfWeekFromDateString,
  toDateOnly
};
