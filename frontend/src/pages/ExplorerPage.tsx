import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Download, Search } from "lucide-react";
import { api } from "../lib/api";
import { StatusTag } from "../components/StatusTag";
import type { ExplorerRow, StatusBucket } from "../types";

export function ExplorerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<ExplorerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const status = params.get("status") || "";

  useEffect(() => {
    setLoading(true);
    api
      .get("/lubrication-points", { params: { search: search || undefined, status: status || undefined, pageSize: 200 } })
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  }, [search, status]);

  function setStatusFilter(s: string) {
    if (s) setParams({ status: s }); else setParams({});
  }

  function exportCsv() {
    const headers = ["LP ID", "Equipment", "Area", "Contractor", "Lubricant", "Qty (L)", "Frequency", "Last Change", "Next Due", "Status"];
    const csvRows = rows.map((r) => [
      r.lpIdCode, r.assetName, r.areaName ?? "", r.contractor ?? "", r.lubricantType ?? "",
      r.standardQuantityL ?? "", r.frequencyLabel ?? "", r.lastChangeDate ?? "", r.nextDue ?? "", r.status,
    ]);
    const csv = [headers, ...csvRows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "lubrication_explorer.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const statusOptions: StatusBucket[] = ["OVERDUE", "DUE_TODAY", "DUE_THIS_WEEK", "DUE_THIS_MONTH", "OK", "CONDITION_MONITORING"];

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{t("explorer.title")}</h1>
        <button onClick={exportCsv} className="flex items-center gap-1.5 text-sm border border-[var(--color-line)] rounded px-3 py-1.5 bg-white hover:bg-[var(--color-canvas)]">
          <Download size={15} /> {t("explorer.export")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[260px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)]" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("explorer.search") as string}
            className="w-full border border-[var(--color-line)] rounded pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-signal-blue)]"
          />
        </div>
        <select value={status} onChange={(e) => setStatusFilter(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm bg-white">
          <option value="">{t("explorer.allStatuses")}</option>
          {statusOptions.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
      </div>

      <p className="text-xs text-[var(--color-ink-muted)] mb-2">{t("explorer.results", { count: total })}</p>

      <div className="bg-white rounded-md border border-[var(--color-line)] overflow-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)] border-b border-[var(--color-line)]">
              <th className="px-3 py-2.5 font-medium">{t("explorer.lpId")}</th>
              <th className="px-3 py-2.5 font-medium">{t("explorer.equipment")}</th>
              <th className="px-3 py-2.5 font-medium">{t("explorer.area")}</th>
              <th className="px-3 py-2.5 font-medium">{t("explorer.contractor")}</th>
              <th className="px-3 py-2.5 font-medium">{t("explorer.lubricant")}</th>
              <th className="px-3 py-2.5 font-medium text-right">{t("explorer.quantity")}</th>
              <th className="px-3 py-2.5 font-medium">{t("explorer.frequency")}</th>
              <th className="px-3 py-2.5 font-medium">{t("explorer.nextDue")}</th>
              <th className="px-3 py-2.5 font-medium">{t("explorer.status")}</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.map((r) => (
              <tr
                key={r.id} onClick={() => navigate(`/explorer/${r.id}`)}
                className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-canvas)] cursor-pointer"
              >
                <td className="px-3 py-2 font-[var(--font-mono)] text-xs" style={{ fontFamily: "var(--font-mono)" }}>{r.lpIdCode}</td>
                <td className="px-3 py-2">{r.assetName}</td>
                <td className="px-3 py-2 text-[var(--color-ink-muted)]">{r.areaName}</td>
                <td className="px-3 py-2 text-[var(--color-ink-muted)]">{r.contractor}</td>
                <td className="px-3 py-2">{r.lubricantType ?? "—"}</td>
                <td className="px-3 py-2 text-right font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)" }}>{r.standardQuantityL ?? "—"}</td>
                <td className="px-3 py-2">{r.frequencyLabel ?? "—"}</td>
                <td className="px-3 py-2">{r.nextDue ? new Date(r.nextDue).toLocaleDateString() : "—"}</td>
                <td className="px-3 py-2"><StatusTag status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <p className="p-8 text-center text-sm text-[var(--color-ink-muted)]">{t("explorer.noResults")}</p>}
        {loading && <p className="p-8 text-center text-sm text-[var(--color-ink-muted)]">{t("common.loading")}</p>}
      </div>
    </div>
  );
}
