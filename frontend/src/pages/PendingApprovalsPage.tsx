import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface PendingRecord {
  id: string;
  lpIdCode: string;
  equipment: string;
  contractor: string | null;
  technician: string | null;
  lubricationDate: string;
  quantityUsedL: number | null;
  oilType: string | null;
  remarks: string | null;
  submittedAt: string;
}

export function PendingApprovalsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [records, setRecords] = useState<PendingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get("/lubrication-records/pending").then((r) => setRecords(r.data.records)).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function approve(id: string) {
    setError(null);
    try {
      await api.patch(`/lubrication-records/${id}/approve`);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function reject() {
    if (!rejectingId) return;
    setError(null);
    try {
      await api.patch(`/lubrication-records/${rejectingId}/reject`, { reason: rejectReason });
      setRejectingId(null);
      setRejectReason("");
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const canAct = !!user?.capabilities.approve;

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "var(--font-display)" }}>{t("nav.pendingApprovals")}</h1>
      <p className="text-sm text-[var(--color-ink-muted)] mb-6">{records.length} submission(s) awaiting review</p>

      {error && <p className="text-sm mb-4" style={{ color: "var(--color-signal-red)" }}>{error}</p>}

      <div className="flex flex-col gap-3">
        {!loading && records.map((r) => (
          <div key={r.id} className="bg-white rounded-md border border-[var(--color-line)] p-4 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-[var(--font-mono)] text-sm font-medium" style={{ fontFamily: "var(--font-mono)" }}>{r.lpIdCode}</span>
                <span className="text-sm text-[var(--color-ink-muted)]">{r.equipment}</span>
              </div>
              <p className="text-xs text-[var(--color-ink-muted)]">
                {r.contractor} · {r.technician} · {new Date(r.lubricationDate).toLocaleDateString()}
                {r.quantityUsedL != null && ` · ${r.quantityUsedL} L`}{r.oilType && ` · ${r.oilType}`}
              </p>
              {r.remarks && <p className="text-sm mt-2 text-[var(--color-ink-muted)] italic">"{r.remarks}"</p>}
            </div>
            {canAct && (
              <div className="flex gap-2 shrink-0">
                <button onClick={() => approve(r.id)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded text-white" style={{ background: "var(--color-signal-green)" }}>
                  <Check size={14} /> {t("common.approve")}
                </button>
                <button onClick={() => setRejectingId(r.id)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">
                  <X size={14} /> {t("common.reject")}
                </button>
              </div>
            )}
          </div>
        ))}
        {!loading && records.length === 0 && <p className="text-sm text-[var(--color-ink-muted)] p-4">Nothing pending right now.</p>}
        {loading && <p className="text-sm text-[var(--color-ink-muted)] p-4">{t("common.loading")}</p>}
      </div>

      {rejectingId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setRejectingId(null)}>
          <div className="bg-white rounded-md p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-4" style={{ fontFamily: "var(--font-display)" }}>Reject submission</h3>
            <textarea
              value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} required
              placeholder="Reason for rejection (sent to the technician)"
              className="w-full border border-[var(--color-line)] rounded px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRejectingId(null)} className="text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">{t("common.cancel")}</button>
              <button onClick={reject} disabled={!rejectReason} className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: "var(--color-signal-red)" }}>
                {t("common.reject")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
