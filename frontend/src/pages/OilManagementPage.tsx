import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { Plus } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../context/AuthContext";

type Tab = "consumption" | "forecast" | "purchaseLog";

interface ConsumptionRow { key: string; plannedL: number; actualL: number; varianceL: number }
interface ForecastRow { lubricantType: string; quantityL: number }
interface PurchaseRow { id: string; organization: string; lubricantType: string; quantityL: number; purchaseDate: string; loggedBy: string | null }
interface LubricantType { id: string; name: string }

export function OilManagementPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("consumption");

  const [groupBy, setGroupBy] = useState("lubricant");
  const [consumption, setConsumption] = useState<ConsumptionRow[]>([]);
  const [forecast, setForecast] = useState<ForecastRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [lubricantTypes, setLubricantTypes] = useState<LubricantType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddPurchase, setShowAddPurchase] = useState(false);

  useEffect(() => {
    api.get("/lookups/lubricant-types").then((r) => setLubricantTypes(r.data.lubricantTypes));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    if (tab === "consumption") {
      api.get("/oil-management/consumption", { params: { groupBy } }).then((r) => setConsumption(r.data.rows)).catch((e) => setError(apiErrorMessage(e))).finally(() => setLoading(false));
    } else if (tab === "forecast") {
      api.get("/oil-management/forecast", { params: { organizationId: user?.dataScope === "ALL_ORGS" ? undefined : user?.organizationId } })
        .then((r) => setForecast(r.data.forecast)).catch((e) => setError(apiErrorMessage(e))).finally(() => setLoading(false));
    } else {
      api.get("/oil-management/purchase-log").then((r) => setPurchases(r.data.purchases)).catch((e) => setError(apiErrorMessage(e))).finally(() => setLoading(false));
    }
  }, [tab, groupBy, user]);

  const canLogPurchase = !!user?.capabilities.managePurchaseLog;

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: "var(--font-display)" }}>{t("nav.oilManagement")}</h1>

      <div className="flex gap-1 border-b border-[var(--color-line)] mb-5">
        {(["consumption", "forecast", "purchaseLog"] as Tab[]).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === tb ? "border-[var(--color-panel)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-ink-muted)]"}`}>
            {tb === "consumption" ? "Consumption" : tb === "forecast" ? "30-Day Forecast" : "Purchase Log"}
          </button>
        ))}
      </div>

      {error && <p className="text-sm mb-4" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
      {loading && <p className="text-sm text-[var(--color-ink-muted)]">{t("common.loading")}</p>}

      {!loading && tab === "consumption" && (
        <div className="flex flex-col gap-4">
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="self-end border border-[var(--color-line)] rounded px-3 py-1.5 text-sm bg-white">
            <option value="lubricant">By Lubricant</option>
            <option value="area">By Area</option>
            <option value="equipment">By Equipment</option>
          </select>
          <div className="bg-white rounded-md border border-[var(--color-line)] p-5">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={consumption}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
                <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="plannedL" name="Planned (L)" fill="var(--color-signal-blue)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="actualL" name="Actual (L)" fill="var(--color-signal-amber)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-md border border-[var(--color-line)] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)] border-b border-[var(--color-line)]">
                  <th className="px-3 py-2.5 font-medium">Key</th>
                  <th className="px-3 py-2.5 font-medium text-right">Planned (L)</th>
                  <th className="px-3 py-2.5 font-medium text-right">Actual (L)</th>
                  <th className="px-3 py-2.5 font-medium text-right">Variance (L)</th>
                </tr>
              </thead>
              <tbody>
                {consumption.map((r) => (
                  <tr key={r.key} className="border-b border-[var(--color-line)] last:border-0">
                    <td className="px-3 py-2">{r.key}</td>
                    <td className="px-3 py-2 text-right font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)" }}>{r.plannedL}</td>
                    <td className="px-3 py-2 text-right font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)" }}>{r.actualL}</td>
                    <td className="px-3 py-2 text-right font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)", color: r.varianceL > 0 ? "var(--color-signal-red)" : "var(--color-signal-green)" }}>
                      {r.varianceL > 0 ? "+" : ""}{r.varianceL}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === "forecast" && (
        <div className="bg-white rounded-md border border-[var(--color-line)] p-5">
          <p className="text-xs text-[var(--color-ink-muted)] mb-4">Estimated lubricant quantities needed for points overdue or due within 30 days.</p>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={forecast}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
              <XAxis dataKey="lubricantType" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Bar dataKey="quantityL" name="Quantity (L)" fill="var(--color-signal-green)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && tab === "purchaseLog" && (
        <div className="flex flex-col gap-4">
          {canLogPurchase && (
            <button onClick={() => setShowAddPurchase(true)} className="self-end flex items-center gap-1.5 text-sm rounded px-3 py-1.5 text-white" style={{ background: "var(--color-panel)" }}>
              <Plus size={15} /> Log Purchase
            </button>
          )}
          <div className="bg-white rounded-md border border-[var(--color-line)] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)] border-b border-[var(--color-line)]">
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Organization</th>
                  <th className="px-3 py-2.5 font-medium">Lubricant</th>
                  <th className="px-3 py-2.5 font-medium text-right">Quantity (L)</th>
                  <th className="px-3 py-2.5 font-medium">Logged By</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--color-line)] last:border-0">
                    <td className="px-3 py-2">{new Date(p.purchaseDate).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{p.organization}</td>
                    <td className="px-3 py-2">{p.lubricantType}</td>
                    <td className="px-3 py-2 text-right font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)" }}>{p.quantityL}</td>
                    <td className="px-3 py-2 text-[var(--color-ink-muted)]">{p.loggedBy ?? "—"}</td>
                  </tr>
                ))}
                {purchases.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-[var(--color-ink-muted)]">No purchases logged yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddPurchase && (
        <AddPurchaseModal
          lubricantTypes={lubricantTypes}
          onClose={() => setShowAddPurchase(false)}
          onSaved={() => { setShowAddPurchase(false); api.get("/oil-management/purchase-log").then((r) => setPurchases(r.data.purchases)); }}
        />
      )}
    </div>
  );
}

function AddPurchaseModal({ lubricantTypes, onClose, onSaved }: { lubricantTypes: LubricantType[]; onClose: () => void; onSaved: () => void }) {
  const [lubricantTypeId, setLubricantTypeId] = useState("");
  const [quantityL, setQuantityL] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await api.post("/oil-management/purchase-log", { lubricantTypeId, quantityL: parseFloat(quantityL), purchaseDate });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-md p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-4" style={{ fontFamily: "var(--font-display)" }}>Log oil purchase</h3>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Lubricant Type
            <select value={lubricantTypeId} onChange={(e) => setLubricantTypeId(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm">
              <option value="">Select…</option>
              {lubricantTypes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Quantity (L)
            <input type="number" step="0.1" value={quantityL} onChange={(e) => setQuantityL(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Purchase Date
            <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" />
          </label>
          {error && <p className="text-sm" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">Cancel</button>
            <button onClick={save} disabled={!lubricantTypeId || !quantityL || saving} className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: "var(--color-panel)" }}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
