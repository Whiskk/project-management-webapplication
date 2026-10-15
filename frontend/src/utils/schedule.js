/**
 * Date maths for the employee's schedule timeline. Dates are ISO strings
 * ("2026-10-15") handled in UTC so no timezone can shift a day.
 */

const DAY_MS = 86_400_000;

const toTime = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const toIso = (time) => new Date(time).toISOString().slice(0, 10);

/** Today's date in the viewer's own timezone, as an ISO string. */
export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso, days) {
  return toIso(toTime(iso) + days * DAY_MS);
}

/** The Monday of the week containing ``iso``. */
export function weekStart(iso) {
  const time = toTime(iso);
  const sinceMonday = (new Date(time).getUTCDay() + 6) % 7;
  return toIso(time - sinceMonday * DAY_MS);
}

/** ``count`` working weeks from the current one: ``[{start: Monday, end: Friday}]``. */
export function buildWeeks(today, count) {
  const first = weekStart(today);
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(first, 7 * i);
    return { start, end: addDays(start, 4) };
  });
}

/** Whether a project runs during any working day of a week. */
function overlaps(project, week) {
  return project.start_date <= week.end && project.predicted_end_date >= week.start;
}

/**
 * Hours per week across the employee's projects: ``confirmed`` (approved) and
 * ``pending`` (requested on top, awaiting their manager), matching what the
 * 40-hour rule counts.
 */
export function weeklyHours(schedule, weeks) {
  return weeks.map((week) => {
    let confirmed = 0;
    let pending = 0;
    schedule.filter((project) => overlaps(project, week)).forEach((project) => {
      const approved = Number(project.hours_per_week ?? 0);
      const reserved = Number(project.pending_hours ?? project.hours_per_week ?? 0);
      confirmed += approved;
      pending += Math.max(reserved - approved, 0);
    });
    return { ...week, confirmed, pending };
  });
}

/** Position of a date within a window of ``days`` starting at ``windowStart``, as 0-100%. */
export function percentAlong(iso, windowStart, days) {
  const percent = ((toTime(iso) - toTime(windowStart)) / DAY_MS / days) * 100;
  return Math.min(Math.max(percent, 0), 100);
}
