import { useTranslation } from "react-i18next";
import type { StatusBucket } from "../types";

const STATUS_STYLE: Record<StatusBucket, { color: string; bg: string }> = {
  OVERDUE: { color: "var(--color-signal-red)", bg: "var(--color-signal-red-bg)" },
  DUE_TODAY: { color: "var(--color-signal-amber)", bg: "var(--color-signal-amber-bg)" },
  DUE_THIS_WEEK: { color: "var(--color-signal-amber)", bg: "var(--color-signal-amber-bg)" },
  DUE_THIS_MONTH: { color: "var(--color-signal-blue)", bg: "var(--color-signal-blue-bg)" },
  OK: { color: "var(--color-signal-green)", bg: "var(--color-signal-green-bg)" },
  NO_HISTORY: { color: "var(--color-signal-gray)", bg: "var(--color-signal-gray-bg)" },
  CONDITION_MONITORING: { color: "var(--color-signal-gray)", bg: "var(--color-signal-gray-bg)" },
};

export function StatusTag({ status }: { status: StatusBucket }) {
  const { t } = useTranslation();
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.NO_HISTORY;
  return (
    <span className="status-tag" style={{ color: style.color, background: style.bg }}>
      {t(`status.${status}`)}
    </span>
  );
}

const PRIORITY_STYLE: Record<string, { color: string; bg: string }> = {
  LOW: { color: "var(--color-signal-gray)", bg: "var(--color-signal-gray-bg)" },
  MEDIUM: { color: "var(--color-signal-blue)", bg: "var(--color-signal-blue-bg)" },
  HIGH: { color: "var(--color-signal-amber)", bg: "var(--color-signal-amber-bg)" },
  CRITICAL: { color: "var(--color-signal-red)", bg: "var(--color-signal-red-bg)" },
  INFO: { color: "var(--color-signal-blue)", bg: "var(--color-signal-blue-bg)" },
  WARNING: { color: "var(--color-signal-amber)", bg: "var(--color-signal-amber-bg)" },
};

export function PriorityTag({ priority }: { priority: string }) {
  const style = PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.MEDIUM;
  return (
    <span className="status-tag" style={{ color: style.color, background: style.bg }}>
      {priority}
    </span>
  );
}
