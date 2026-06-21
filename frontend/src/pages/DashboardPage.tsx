import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { KpiCard } from "../components/KpiCard";
import type { DashboardKpis } from "../types";

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [scope, setScope] = useState("all");
  const [breakdown, setBreakdown] = useState<{ key: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get("/dashboard/kpis", { params: { scope } }),
      api.get("/dashboard/overdue-breakdown", { params: { groupBy: user?.dataScope === "ALL_ORGS" ? "contractor" : "area" } }),
    ])
      .then(([kpiRes, breakdownRes]) => {
        setKpis(kpiRes.data);
        setBreakdown(breakdownRes.data.breakdown);
      })
      .finally(() => setLoading(false));
  }, [scope, user]);

  if (loading || !kpis) {
    return <div className="p-8 text-sm text-[var(--color-ink-muted)]">{t("common.loading")}</div>;
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{t("dashboard.title")}</h1>
        {user?.dataScope === "ALL_ORGS" && (
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="border border-[var(--color-line)] rounded px-3 py-1.5 text-sm bg-white"
          >
            <option value="all">{t("dashboard.scopeAll")}</option>
            <option value="rhi">RHI</option>
            <option value="asec">ASEC</option>
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        <KpiCard label={t("dashboard.totalPoints")} value={kpis.totalLubricationPoints} tone="neutral"
          onClick={() => navigate("/explorer")} />
        <KpiCard label={t("dashboard.overdue")} value={kpis.overdue} tone="red"
          onClick={() => navigate("/explorer?status=OVERDUE")} />
        <KpiCard label={t("dashboard.dueThisWeek")} value={kpis.dueThisWeek} tone="amber"
          onClick={() => navigate("/explorer?status=DUE_THIS_WEEK")} />
        <KpiCard label={t("dashboard.dueThisMonth")} value={kpis.dueThisMonth} tone="blue"
          onClick={() => navigate("/explorer?status=DUE_THIS_MONTH")} />
        <KpiCard label={t("dashboard.compliance")} value={`${kpis.compliancePct}%`} tone={kpis.compliancePct < 70 ? "red" : "green"} />

        <KpiCard label={t("dashboard.conditionMonitoring")} value={kpis.conditionMonitoringPoints} tone="neutral" />
        <KpiCard label={t("dashboard.oilSamplesOverdue")} value={kpis.oilSamplesOverdue} tone="red"
          onClick={() => navigate("/oil-samples")} />
        <KpiCard label={t("dashboard.oilSamplesDue")} value={kpis.oilSamplesDueThisMonth} tone="amber" />
        <KpiCard label={t("dashboard.pendingApproval")} value={kpis.pendingApproval} tone="blue"
          onClick={() => navigate("/approvals")} />
        <KpiCard label={t("dashboard.completedThisMonth")} value={kpis.completedThisMonth} tone="green" />

        <KpiCard label={t("dashboard.openActionPlans")} value={kpis.openActionPlans} tone="blue"
          onClick={() => navigate("/action-plans")} />
        <KpiCard label={t("dashboard.overdueActionPlans")} value={kpis.overdueActionPlans} tone="red"
          onClick={() => navigate("/action-plans?status=OPEN")} />
      </div>

      <div className="bg-white rounded-md border border-[var(--color-line)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-4">
          {t("dashboard.overdueBreakdown")}
        </h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={breakdown}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
            <XAxis dataKey="key" tick={{ fontSize: 12, fontFamily: "var(--font-mono)" }} />
            <YAxis tick={{ fontSize: 12, fontFamily: "var(--font-mono)" }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontFamily: "var(--font-body)", fontSize: 13, borderRadius: 6 }} />
            <Bar dataKey="count" fill="var(--color-signal-red)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
