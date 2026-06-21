/**
 * Due-date, status-bucket, and compliance logic — Handover Section 6.
 *
 * Deliberately framework-free (no Prisma import) so it can be unit
 * tested with plain ts-node/tsx and reused identically by the API,
 * the dashboard KPI aggregator, and the daily route generator.
 *
 * Frequency types (Section 6.1):
 *  - CALENDAR     — has a real due date: lastChangeDate + intervalDays.
 *                   This is the ONLY bucket counted in compliance %.
 *  - OIL_ANALYSIS — no fixed due date; tracked via oaLastSampleDate +
 *                   oaIntervalDays instead, reported separately.
 *  - AS_NEEDED    — "condition monitoring"; never overdue, never red.
 */

export type FrequencyType = "CALENDAR" | "OIL_ANALYSIS" | "AS_NEEDED";

export type StatusBucket =
  | "OVERDUE"
  | "DUE_TODAY"
  | "DUE_THIS_WEEK"
  | "DUE_THIS_MONTH"
  | "OK"
  | "NO_HISTORY"
  | "CONDITION_MONITORING";

export const CALENDAR_INTERVAL_DAYS: Record<string, number> = {
  "0.5 Y": 183,
  "1 Y": 365,
  "1.5 Y": 548,
  "2 Y": 730,
  "3 Y": 1095,
  "4 Y": 1460,
  "5 Y": 1825,
};

function daysBetween(from: Date, to: Date): number {
  const ms = to.setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}

function bucketFromDaysToDue(daysToDue: number): StatusBucket {
  if (daysToDue < 0) return "OVERDUE";
  if (daysToDue === 0) return "DUE_TODAY";
  if (daysToDue <= 7) return "DUE_THIS_WEEK";
  if (daysToDue <= 30) return "DUE_THIS_MONTH";
  return "OK";
}

export interface LpForStatus {
  id: string;
  frequencyType: FrequencyType;
  frequencyIntervalDays: number | null;
  lastChangeDateCache: Date | string | null;
  oaRequired: boolean;
  oaIntervalDays: number | null;
  oaLastSampleDate: Date | string | null;
}

export interface LpStatusResult {
  lpId: string;
  nextDue: Date | null;
  daysToDue: number | null;
  bucket: StatusBucket;
}

/** Status for the LP's primary (calendar) lubrication schedule. */
export function computeLubricationStatus(lp: LpForStatus, today: Date = new Date()): LpStatusResult {
  if (lp.frequencyType === "AS_NEEDED") {
    return { lpId: lp.id, nextDue: null, daysToDue: null, bucket: "CONDITION_MONITORING" };
  }
  if (lp.frequencyType === "OIL_ANALYSIS") {
    // Oil-analysis points have no calendar due date of their own — they're
    // tracked via computeOilAnalysisStatus instead. They don't enter the
    // primary lubrication compliance bucket at all.
    return { lpId: lp.id, nextDue: null, daysToDue: null, bucket: "CONDITION_MONITORING" };
  }
  // CALENDAR
  if (!lp.lastChangeDateCache || !lp.frequencyIntervalDays) {
    return { lpId: lp.id, nextDue: null, daysToDue: null, bucket: "NO_HISTORY" };
  }
  const lastChange = new Date(lp.lastChangeDateCache);
  const nextDue = new Date(lastChange);
  nextDue.setDate(nextDue.getDate() + lp.frequencyIntervalDays);
  const daysToDue = daysBetween(today, nextDue);
  return { lpId: lp.id, nextDue, daysToDue, bucket: bucketFromDaysToDue(daysToDue) };
}

/** Status for the LP's oil-analysis schedule (Section 6.1, tracked separately). */
export function computeOilAnalysisStatus(lp: LpForStatus, today: Date = new Date()): LpStatusResult {
  if (!lp.oaRequired) {
    return { lpId: lp.id, nextDue: null, daysToDue: null, bucket: "CONDITION_MONITORING" };
  }
  if (!lp.oaLastSampleDate || !lp.oaIntervalDays) {
    return { lpId: lp.id, nextDue: null, daysToDue: null, bucket: "NO_HISTORY" };
  }
  const lastSample = new Date(lp.oaLastSampleDate);
  const nextDue = new Date(lastSample);
  nextDue.setDate(nextDue.getDate() + lp.oaIntervalDays);
  const daysToDue = daysBetween(today, nextDue);
  return { lpId: lp.id, nextDue, daysToDue, bucket: bucketFromDaysToDue(daysToDue) };
}

export interface ComplianceStats {
  totalCalendarPoints: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  dueThisMonth: number;
  ok: number;
  noHistory: number;
  compliancePct: number; // (total - overdue) / total * 100, excludes OA & as-needed entirely
}

/** Section 6.4 — compliance % is computed ONLY over CALENDAR-type points. */
export function computeComplianceStats(points: LpForStatus[], today: Date = new Date()): ComplianceStats {
  const calendarPoints = points.filter((p) => p.frequencyType === "CALENDAR");
  const stats: ComplianceStats = {
    totalCalendarPoints: calendarPoints.length,
    overdue: 0,
    dueToday: 0,
    dueThisWeek: 0,
    dueThisMonth: 0,
    ok: 0,
    noHistory: 0,
    compliancePct: 0,
  };
  for (const p of calendarPoints) {
    const { bucket } = computeLubricationStatus(p, today);
    switch (bucket) {
      case "OVERDUE": stats.overdue++; break;
      case "DUE_TODAY": stats.dueToday++; break;
      case "DUE_THIS_WEEK": stats.dueThisWeek++; break;
      case "DUE_THIS_MONTH": stats.dueThisMonth++; break;
      case "OK": stats.ok++; break;
      case "NO_HISTORY": stats.noHistory++; break;
    }
  }
  stats.compliancePct = stats.totalCalendarPoints
    ? Math.round(((stats.totalCalendarPoints - stats.overdue) / stats.totalCalendarPoints) * 1000) / 10
    : 0;
  return stats;
}

export interface OilAnalysisStats {
  totalOaPoints: number;
  overdue: number;
  dueThisMonth: number;
  ok: number;
  noHistory: number;
}

export function computeOilAnalysisStats(points: LpForStatus[], today: Date = new Date()): OilAnalysisStats {
  const oaPoints = points.filter((p) => p.oaRequired);
  const stats: OilAnalysisStats = { totalOaPoints: oaPoints.length, overdue: 0, dueThisMonth: 0, ok: 0, noHistory: 0 };
  for (const p of oaPoints) {
    const { bucket } = computeOilAnalysisStatus(p, today);
    if (bucket === "OVERDUE") stats.overdue++;
    else if (bucket === "DUE_THIS_WEEK" || bucket === "DUE_THIS_MONTH") stats.dueThisMonth++;
    else if (bucket === "OK") stats.ok++;
    else if (bucket === "NO_HISTORY") stats.noHistory++;
  }
  return stats;
}
