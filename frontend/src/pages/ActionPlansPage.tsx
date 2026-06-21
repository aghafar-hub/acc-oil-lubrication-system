import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PriorityTag } from "../components/StatusTag";

interface ActionPlanRow {
  id: string;
  actionType: string;
  autoOrManual: string;
  equipment: string;
  equipmentCode: string;
  contractor: string | null;
  description: string;
  priority: string;
  owner: string | null;
  dueDate: string | null;
  status: string;
  createdAt: string;
  closedDate: string | null;
  closureComments: string | null;
}

export function ActionPlansPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [plans, setPlans] = useState<ActionPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closureComments, setClosureComments] = useState("");
  const [error, setError] = useState<string | null>(null);
  const statusFilter = params.get("status") || "";

  function load() {
    setLoading(true);
    api.get("/action-plans", { params: { status: statusFilter || undefined } }).then((r) => setPlans(r.data.actionPlans)).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [statusFilter]);

  async function close() {
    if (!closingId) return;
    setError(null);
    try {
      await api.patch(`/action-plans/${closingId}/close`, { closureComments });
      setClosingId(null);
      setClosureComments("");
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const canClose = !!user?.capabilities.closeActions;

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: "var(--font-display)" }}>{t("nav.actionPlans")}</h1>

      {error && <p className="text-sm mb-4" style={{ color: "var(--color-signal-red)" }}>{error}</p>}

      <div className="flex flex-col gap-3">
        {!loading && plans.map((p) => (
          <div key={p.id} className="bg-white rounded-md border border-[var(--color-line)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm">{p.actionType}</span>
                  <PriorityTag priority={p.priority} />
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-canvas)] text-[var(--color-ink-muted)]">{p.autoOrManual}</span>
                </div>
                <p className="text-sm text-[var(--color-ink-muted)] mb-1">{p.equipment} ({p.equipmentCode}) · {p.contractor}</p>
                <p className="text-sm">{p.description}</p>
                <p className="text-xs text-[var(--color-ink-muted)] mt-1">
                  Owner: {p.owner ?? "Unassigned"}{p.dueDate ? ` · Due ${new Date(p.dueDate).toLocaleDateString()}` : ""}
                </p>
                {p.closureComments && <p className="text-xs text-[var(--color-ink-muted)] mt-1 italic">Closed: "{p.closureComments}"</p>}
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className="text-xs font-medium px-2 py-1 rounded bg-[var(--color-canvas)]">{p.status}</span>
                {canClose && p.status !== "COMPLETED" && p.status !== "CANCELLED" && (
                  <button onClick={() => setClosingId(p.id)} className="text-xs px-2.5 py-1 rounded text-white" style={{ background: "var(--color-signal-green)" }}>
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {!loading && plans.length === 0 && <p className="text-sm text-[var(--color-ink-muted)] p-4">No action plans.</p>}
        {loading && <p className="text-sm text-[var(--color-ink-muted)] p-4">{t("common.loading")}</p>}
      </div>

      {closingId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setClosingId(null)}>
          <div className="bg-white rounded-md p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-4" style={{ fontFamily: "var(--font-display)" }}>Close action plan</h3>
            <textarea
              value={closureComments} onChange={(e) => setClosureComments(e.target.value)} rows={3} required
              placeholder="Closure comments (required)"
              className="w-full border border-[var(--color-line)] rounded px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setClosingId(null)} className="text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">{t("common.cancel")}</button>
              <button onClick={close} disabled={!closureComments} className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: "var(--color-panel)" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
