import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Pencil } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { StatusTag } from "../components/StatusTag";
import { PriorityTag } from "../components/StatusTag";
import type { StatusBucket } from "../types";

interface LpDetail {
  id: string;
  lpIdCode: string;
  pointDescription: string;
  pointCode: string | null;
  position: string | null;
  equipment: { id: string; code: string; name: string; area: string | null; contractor: string | null; gearboxBrand: string | null; opTempC: number | null; annualRhActual: number | null };
  lubricantType: { name: string; brand: string | null } | null;
  standardQuantityL: number | null;
  frequencyLabel: string | null;
  frequencyType: string;
  ohHoursReference: string | null;
  oaRequired: boolean;
  oaIntervalLabel: string | null;
  remarks: string | null;
  status: StatusBucket;
  nextDue: string | null;
  oaStatus: StatusBucket | null;
  history: { id: string; date: string; technician: string | null; quantityUsedL: number | null; oilType: string | null; status: string; remarks: string | null; isLegacyImport: boolean; approvedBy: string | null }[];
  oilSamples: { id: string; sampledDate: string; reportStatus: string; sampleIdLab: string }[];
  actionPlans: { id: string; type: string; description: string; priority: string; status: string; owner: string | null; dueDate: string | null }[];
}

type Tab = "details" | "history" | "actionPlans";

export function LpDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [lp, setLp] = useState<LpDetail | null>(null);
  const [tab, setTab] = useState<Tab>("details");
  const [editing, setEditing] = useState(false);
  const [editReason, setEditReason] = useState("");
  const [editQty, setEditQty] = useState<string>("");
  const [editRemarks, setEditRemarks] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    api.get(`/lubrication-points/${id}`).then((r) => {
      setLp(r.data);
      setEditQty(r.data.standardQuantityL?.toString() ?? "");
      setEditRemarks(r.data.remarks ?? "");
    });
  }

  useEffect(() => { load(); }, [id]);

  async function saveEdit() {
    setSaveError(null);
    try {
      await api.patch(`/lubrication-points/${id}`, {
        standardQuantityL: editQty ? parseFloat(editQty) : null,
        remarks: editRemarks || null,
        reason: editReason,
      });
      setEditing(false);
      setEditReason("");
      load();
    } catch (err) {
      setSaveError(apiErrorMessage(err));
    }
  }

  if (!lp) return <div className="p-8 text-sm text-[var(--color-ink-muted)]">{t("common.loading")}</div>;

  const canEdit = !!user?.capabilities.editData;

  return (
    <div className="p-8 max-w-5xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] mb-4">
        <ArrowLeft size={15} /> {t("common.back")}
      </button>

      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-[var(--font-mono)] text-sm text-[var(--color-ink-muted)]" style={{ fontFamily: "var(--font-mono)" }}>{lp.lpIdCode}</div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{lp.pointDescription}</h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusTag status={lp.status} />
          {canEdit && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-sm border border-[var(--color-line)] rounded px-3 py-1.5 bg-white hover:bg-[var(--color-canvas)]">
              <Pencil size={14} /> {t("common.edit")}
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-[var(--color-ink-muted)] mb-6">
        {lp.equipment.name} · {lp.equipment.area} · {lp.equipment.contractor}
      </p>

      <div className="flex gap-1 border-b border-[var(--color-line)] mb-5">
        {(["details", "history", "actionPlans"] as Tab[]).map((tb) => (
          <button
            key={tb} onClick={() => setTab(tb)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === tb ? "border-[var(--color-panel)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-ink-muted)]"}`}
          >
            {tb === "details" ? "Details" : tb === "history" ? "History" : "Action Plans"}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 bg-white rounded-md border border-[var(--color-line)] p-6">
          <Field label="Equipment Code" value={lp.equipment.code} mono />
          <Field label="Point Code" value={lp.pointCode ?? "—"} />
          <Field label="Position" value={lp.position ?? "—"} />
          <Field label="Lubricant Type" value={lp.lubricantType ? `${lp.lubricantType.name}${lp.lubricantType.brand ? " (" + lp.lubricantType.brand + ")" : ""}` : "—"} />
          <Field label="Standard Quantity" value={lp.standardQuantityL != null ? `${lp.standardQuantityL} L` : "—"} mono />
          <Field label="Frequency" value={lp.frequencyLabel ?? "—"} />
          <Field label="OH Hours Reference" value={lp.ohHoursReference ?? "—"} />
          <Field label="Next Due" value={lp.nextDue ? new Date(lp.nextDue).toLocaleDateString() : "—"} />
          {lp.oaRequired && <Field label="Oil Analysis Interval" value={lp.oaIntervalLabel ?? "—"} />}
          {lp.oaRequired && lp.oaStatus && (
            <div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)] mb-1">Oil Analysis Status</div>
              <StatusTag status={lp.oaStatus} />
            </div>
          )}
          <Field label="Gearbox Brand" value={lp.equipment.gearboxBrand ?? "—"} />
          <Field label="Operating Temp" value={lp.equipment.opTempC != null ? `${lp.equipment.opTempC} °C` : "—"} />
          <div className="col-span-2">
            <Field label="Remarks" value={lp.remarks ?? "—"} />
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="bg-white rounded-md border border-[var(--color-line)] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)] border-b border-[var(--color-line)]">
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Technician</th>
                <th className="px-3 py-2.5 font-medium text-right">Qty (L)</th>
                <th className="px-3 py-2.5 font-medium">Oil Type</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {lp.history.map((h) => (
                <tr key={h.id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="px-3 py-2">{new Date(h.date).toLocaleDateString()}</td>
                  <td className="px-3 py-2">{h.technician ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)" }}>{h.quantityUsedL ?? "—"}</td>
                  <td className="px-3 py-2">{h.oilType ?? "—"}</td>
                  <td className="px-3 py-2">{h.status}</td>
                  <td className="px-3 py-2 text-[var(--color-ink-muted)]">{h.remarks ?? "—"}</td>
                </tr>
              ))}
              {lp.history.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-[var(--color-ink-muted)]">No history yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "actionPlans" && (
        <div className="flex flex-col gap-3">
          {lp.actionPlans.map((a) => (
            <div key={a.id} className="bg-white rounded-md border border-[var(--color-line)] p-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm">{a.type}</span>
                  <PriorityTag priority={a.priority} />
                </div>
                <p className="text-sm text-[var(--color-ink-muted)]">{a.description}</p>
                <p className="text-xs text-[var(--color-ink-muted)] mt-1">Owner: {a.owner ?? "Unassigned"}{a.dueDate ? ` · Due ${new Date(a.dueDate).toLocaleDateString()}` : ""}</p>
              </div>
              <span className="text-xs font-medium px-2 py-1 rounded bg-[var(--color-canvas)]">{a.status}</span>
            </div>
          ))}
          {lp.actionPlans.length === 0 && <p className="text-sm text-[var(--color-ink-muted)] p-4">No action plans for this point.</p>}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setEditing(false)}>
          <div className="bg-white rounded-md p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-4" style={{ fontFamily: "var(--font-display)" }}>Correct lubrication point</h3>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Standard Quantity (L)
                <input value={editQty} onChange={(e) => setEditQty(e.target.value)} type="number" step="0.1"
                  className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Remarks
                <textarea value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} rows={2}
                  className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Reason for correction (required)
                <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={2} required
                  className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" placeholder="Visible to the contractor in the audit log" />
              </label>
              {saveError && <p className="text-sm" style={{ color: "var(--color-signal-red)" }}>{saveError}</p>}
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => setEditing(false)} className="text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">{t("common.cancel")}</button>
                <button
                  onClick={saveEdit} disabled={!editReason}
                  className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50"
                  style={{ background: "var(--color-panel)" }}
                >
                  {t("common.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)] mb-1">{label}</div>
      <div className={mono ? "font-[var(--font-mono)] text-sm" : "text-sm"} style={mono ? { fontFamily: "var(--font-mono)" } : undefined}>{value}</div>
    </div>
  );
}
