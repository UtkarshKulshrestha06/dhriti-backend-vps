const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatDateTimeParts,
  formatTimeOnlyString,
  getDayOfWeekFromDateString
} = require("../services/dateTime");

test("formats UTC timestamps as India local date and time", () => {
  assert.deepEqual(formatDateTimeParts(new Date("2026-05-18T19:59:20.470Z")), {
    date: "2026-05-19",
    time: "01:29"
  });
});

test("keeps SQL TIME values as wall-clock time", () => {
  assert.equal(formatTimeOnlyString(new Date("1970-01-01T09:00:00.000Z")), "09:00");
});

test("calculates day of week from date-only strings without timezone drift", () => {
  assert.equal(getDayOfWeekFromDateString("2026-05-19"), 2);
});
