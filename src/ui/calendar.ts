/**
 * Dates and times as the screens write them: "17 Sep", "Wed 9 Sep", "19:10".
 *
 * Written out rather than asked of `Intl`, because Hermes' `Intl` support depends on how the
 * engine was built, and a date on a row is not worth a crash on the one build where it is missing.
 * One module, because the month names used to live inside a formatter, and a second screen that
 * needed them would have grown a second copy.
 *
 * Every function reads the phone's own time zone, because that is the calendar the person is
 * holding it against.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Unix seconds, as the chain gives them. */
const toDate = (seconds: number): Date => new Date(seconds * 1000);

/** "17 Sep". */
export function dayMonth(seconds: number): string {
  const at = toDate(seconds);
  return `${at.getDate()} ${MONTHS[at.getMonth()] ?? ""}`;
}

/** "Wed 9 Sep". */
export function weekdayDayMonth(seconds: number): string {
  return `${WEEKDAYS[toDate(seconds).getDay()] ?? ""} ${dayMonth(seconds)}`;
}

/** "19:10", on the 24-hour clock, which reads the same in every locale. */
export function clockTime(seconds: number): string {
  const at = toDate(seconds);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** Whole calendar days from `seconds` to `now`, by the phone's calendar rather than by 24-hour spans. */
export function daysAgo(seconds: number, now: number = Date.now()): number {
  const then = toDate(seconds);
  const today = new Date(now);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(today) - midnight(then)) / 86_400_000);
}
