import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Zap } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface RouteRow {
  id: string;
  name: string;
  type: string;
  organization: string;
  pointCount: number;
  assignments: { id: string; technician: string; status: string; assignedDate: string }[];
}

interface DynamicPreviewPoint { id: string; lpIdCode: string; equipment: string }

const DYNAMIC_TYPES = [
  { value: "overdue", label: "Overdue" },
  { value: "due_today", label: "Due Today" },
  { value: "due_week", label: "Due This Week" },
  { value: "oil_sample_due", label: "Oil Sample Due" },
];

export function RouteCenterPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showBuild, setShowBuild] = useState(false);
  const [dynamicType, setDynamicType] = useState("overdue");
  const [preview, setPreview] = useState<DynamicPreviewPoint[]>([]);
  const [routeName, setRouteName] = useState("");
  const [technicians, setTechnicians] = useState<{ id: string; name: string }[]>([]);
  const [assigningRouteId, setAssigningRouteId] = useState<string | null>(null);
  const [assignTechnicianId, setAssignTechnicianId] = useState("");

  function load() {
    setLoading(true);
    api.get("/routes").then((r) => setRoutes(r.data.routes)).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!showBuild) return;
    api.get("/routes/dynamic-preview", { params: { type: dynamicType, organizationId: user?.dataScope === "ALL_ORGS" ? undefined : user?.organizationId } })
      .then((r) => setPreview(r.data.points))
      .catch(() => setPreview([]));
  }, [showBuild, dynamicType, user]);

  useEffect(() => {
    if (!assigningRouteId) return;
    api.get("/lookups/technicians").then((r) => setTechnicians(r.data.technicians));
  }, [assigningRouteId]);

  async function createRoute() {
    setError(null);
    try {
      await api.post("/routes", { name: routeName || `${DYNAMIC_TYPES.find((d) => d.value === dynamicType)?.label} Route`, type: "dynamic", lpIds: preview.map((p) => p.id) });
      setShowBuild(false);
      setRouteName("");
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function assign() {
    if (!assigningRouteId || !assignTechnicianId) return;
    setError(null);
    try {
      await api.post(`/routes/${assigningRouteId}/assign`, { technicianId: assignTechnicianId });
      setAssigningRouteId(null);
      setAssignTechnicianId("");
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const canManage = !!user?.capabilities.manageRoutes;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{t("nav.routeCenter")}</h1>
        {canManage && (
          <button onClick={() => setShowBuild(true)} className="flex items-center gap-1.5 text-sm rounded px-3 py-1.5 text-white" style={{ background: "var(--color-panel)" }}>
            <Plus size={15} /> Build Route
          </button>
        )}
      </div>

      {error && <p className="text-sm mb-4" style={{ color: "var(--color-signal-red)" }}>{error}</p>}

      <div className="flex flex-col gap-3">
        {!loading && routes.map((r) => (
          <div key={r.id} className="bg-white rounded-md border border-[var(--color-line)] p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm">{r.name}</span>
                  {r.type === "dynamic" && <Zap size={13} style={{ color: "var(--color-signal-amber)" }} />}
                  <span className="text-xs text-[var(--color-ink-muted)]">{r.organization}</span>
                </div>
                <p className="text-xs text-[var(--color-ink-muted)]">{r.pointCount} points</p>
              </div>
              {canManage && (
                <button onClick={() => setAssigningRouteId(r.id)} className="text-xs px-2.5 py-1 rounded border border-[var(--color-line)]">Assign</button>
              )}
            </div>
            {r.assignments.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--color-line)] flex flex-col gap-1.5">
                {r.assignments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span>{a.technician}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-canvas)]">{a.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {!loading && routes.length === 0 && <p className="text-sm text-[var(--color-ink-muted)] p-4">No routes built yet.</p>}
        {loading && <p className="text-sm text-[var(--color-ink-muted)] p-4">{t("common.loading")}</p>}
      </div>

      {showBuild && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setShowBuild(false)}>
          <div className="bg-white rounded-md p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-4" style={{ fontFamily: "var(--font-display)" }}>Build a dynamic route</h3>
            <label className="flex flex-col gap-1 text-sm mb-3">
              Route name (optional)
              <input value={routeName} onChange={(e) => setRouteName(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-sm mb-3">
              Based on
              <select value={dynamicType} onChange={(e) => setDynamicType(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm">
                {DYNAMIC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
            <p className="text-xs text-[var(--color-ink-muted)] mb-2">{preview.length} point(s) match this criteria right now</p>
            <div className="max-h-48 overflow-auto border border-[var(--color-line)] rounded mb-4">
              {preview.map((p) => (
                <div key={p.id} className="px-3 py-1.5 text-sm border-b border-[var(--color-line)] last:border-0 flex justify-between">
                  <span className="font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)" }}>{p.lpIdCode}</span>
                  <span className="text-[var(--color-ink-muted)]">{p.equipment}</span>
                </div>
              ))}
              {preview.length === 0 && <p className="px-3 py-3 text-sm text-[var(--color-ink-muted)]">No matching points right now.</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowBuild(false)} className="text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">{t("common.cancel")}</button>
              <button onClick={createRoute} disabled={preview.length === 0} className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: "var(--color-panel)" }}>
                Create Route
              </button>
            </div>
          </div>
        </div>
      )}

      {assigningRouteId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setAssigningRouteId(null)}>
          <div className="bg-white rounded-md p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-4" style={{ fontFamily: "var(--font-display)" }}>Assign route</h3>
            <select value={assignTechnicianId} onChange={(e) => setAssignTechnicianId(e.target.value)} className="w-full border border-[var(--color-line)] rounded px-3 py-2 text-sm mb-4">
              <option value="">Select a technician…</option>
              {technicians.map((tch) => <option key={tch.id} value={tch.id}>{tch.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAssigningRouteId(null)} className="text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">{t("common.cancel")}</button>
              <button onClick={assign} disabled={!assignTechnicianId} className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: "var(--color-panel)" }}>
                Assign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
