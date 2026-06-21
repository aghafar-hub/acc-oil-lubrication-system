import type { ReactNode } from "react";

interface KpiCardProps {
  label: string;
  value: number | string;
  tone?: "neutral" | "red" | "amber" | "green" | "blue";
  icon?: ReactNode;
  onClick?: () => void;
}

const TONE_COLOR: Record<string, string> = {
  neutral: "var(--color-line)",
  red: "var(--color-signal-red)",
  amber: "var(--color-signal-amber)",
  green: "var(--color-signal-green)",
  blue: "var(--color-signal-blue)",
};

export function KpiCard({ label, value, tone = "neutral", icon, onClick }: KpiCardProps) {
  const color = TONE_COLOR[tone];
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-md p-4 flex flex-col gap-2 border border-[var(--color-line)] ${onClick ? "hover:shadow-md transition-shadow cursor-pointer" : "cursor-default"}`}
      style={{ borderLeftWidth: 4, borderLeftColor: color }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide font-medium text-[var(--color-ink-muted)]">{label}</span>
        {icon && <span style={{ color }}>{icon}</span>}
      </div>
      <span className="font-[var(--font-display)] text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
        {value}
      </span>
    </button>
  );
}
