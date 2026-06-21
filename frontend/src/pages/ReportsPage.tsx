import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface ReportDef { key: string; label: string; accOnly?: boolean }

const REPORTS: ReportDef[] = [
  { key: "compliance", label: "Compliance Report" },
  { key: "overdue", label: "Overdue Report" },
  { key: "oil-samples", label: "Oil Sample Report" },
  { key: "route-completion", label: "Route Completion Report" },
  { key: "action-plans", label: "Action Plan Report" },
  { key: "contractor-comparison", label: "Contractor Comparison", accOnly: true },
];

export function ReportsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [selected, setSelected] = useState<ReportDef>(REPORTS[0]);
  const [rows, setRows] = useState<Record<string, string | number | null>[]>([]);
  const [loading, setLoading] = useState(false);

  function run(report: ReportDef) {
    setSelected(report);
    setLoading(true);
    api.get(`/reports/${report.key}`).then((r) => {
      setRows(report.key === "compliance" ? r.data.byArea : r.data.rows);
    }).finally(() => setLoading(false));
  }

  async function exportCsv() {
    const res = await api.get(`/reports/${selected.key}`, { params: { format: "csv" }, responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url; a.download = `${selected.key}_report.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const visibleReports = REPORTS.filter((r) => !r.accOnly || user?.dataScope === "ALL_ORGS");
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: "var(--font-display)" }}>{t("nav.reports")}</h1>

      <div className="flex flex-wrap gap-2 mb-5">
        {visibleReports.map((r) => (
          <button
            key={r.key} onClick={() => run(r)}
            className={`text-sm px-3 py-1.5 rounded border ${selected.key === r.key ? "text-white border-transparent" : "border-[var(--color-line)] bg-white"}`}
            style={selected.key === r.key ? { background: "var(--color-panel)" } : undefined}
          >
            {r.label}
          </button>
        ))}
      </div>

      {rows.length === 0 && !loading && (
        <div className="bg-white rounded-md border border-[var(--color-line)] p-10 text-center text-sm text-[var(--color-ink-muted)]">
          Select a report above to run it.
        </div>
      )}

      {loading && <p className="text-sm text-[var(--color-ink-muted)]">{t("common.loading")}</p>}

      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-md border border-[var(--color-line)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-line)]">
            <span className="text-sm font-medium">{selected.label} — {rows.length} row(s)</span>
            <button onClick={exportCsv} className="flex items-center gap-1.5 text-sm border border-[var(--color-line)] rounded px-3 py-1.5 hover:bg-[var(--color-canvas)]">
              <Download size={14} /> {t("explorer.export")}
            </button>
          </div>
          <div className="overflow-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)] border-b border-[var(--color-line)]">
                  {columns.map((c) => <th key={c} className="px-3 py-2.5 font-medium whitespace-nowrap">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--color-line)] last:border-0">
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-2 whitespace-nowrap">
                        {row[c] != null && typeof row[c] !== "object" ? String(row[c]) : row[c] ? new Date(row[c]).toLocaleDateString() : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
