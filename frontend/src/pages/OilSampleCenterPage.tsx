import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, FlaskConical, Upload, Plus, AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { api, apiErrorMessage } from "../lib/api";
import { OIL_SAMPLE_PARAMETERS, PARAM_GROUP_LABELS, PARAM_GROUP_ORDER } from "../lib/oilSampleParams";

interface LpSearchResult {
  id: string;
  lpIdCode: string;
  assetName: string;
  equipmentIdCode: string;
  oaStatus: string | null;
}

interface SampleListItem {
  id: string;
  lpIdCode: string;
  equipment: string;
  sampledDate: string;
  reportStatus: string;
  sampleIdLab: string;
}

interface SampleDetail {
  id: string;
  sampleIdLab: string;
  sampledDate: string;
  reportStatus: string;
  recommendationsText: string | null;
  uploadedBy: string | null;
  lp: { id: string; lpIdCode: string; pointDescription: string };
  equipment: { code: string; name: string; area: string | null; contractor: string | null };
  lubricant: string | null;
  parameterGroups: Record<string, { key: string; label: string; unit: string | null; value: number | null; status: string }[]>;
}

const STATUS_COLOR: Record<string, string> = {
  NORMAL: "var(--color-signal-green)",
  CAUTION: "var(--color-signal-amber)",
  ALERT: "var(--color-signal-red)",
};
const STATUS_BG: Record<string, string> = {
  NORMAL: "var(--color-signal-green-bg)",
  CAUTION: "var(--color-signal-amber-bg)",
  ALERT: "var(--color-signal-red-bg)",
};

export function OilSampleCenterPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<LpSearchResult[]>([]);
  const [selectedLp, setSelectedLp] = useState<LpSearchResult | null>(null);

  const [samples, setSamples] = useState<SampleListItem[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SampleDetail | null>(null);
  const [trend, setTrend] = useState<{ sampledDate: string; values: { key: string; value: number | null; status: string }[] }[]>([]);
  const [lastActions, setLastActions] = useState<{ id: string; actionType: string; description: string; status: string; createdAt: string }[]>([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Equipment/LP search (proxies the Explorer search, filtered to OA-required points)
  useEffect(() => {
    if (search.length < 2) { setSearchResults([]); return; }
    const timeout = setTimeout(() => {
      api.get("/lubrication-points", { params: { search, pageSize: 20 } }).then((r) => {
        setSearchResults(r.data.rows.filter((row: { oaStatus: string | null }) => row.oaStatus !== null));
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);

  function selectLp(lp: LpSearchResult) {
    setSelectedLp(lp);
    setSearch("");
    setSearchResults([]);
  }

  function loadSamples(lpId: string) {
    api.get("/oil-samples", { params: { lpId } }).then((r) => {
      setSamples(r.data.samples);
      if (r.data.samples.length > 0) setSelectedSampleId(r.data.samples[0].id);
      else { setSelectedSampleId(null); setDetail(null); }
    });
    api.get("/oil-samples/trend/" + lpId).then((r) => setTrend(r.data.points));
  }

  useEffect(() => {
    if (!selectedLp) return;
    loadSamples(selectedLp.id);
    api.get("/action-plans").then((r) => {
      setLastActions(r.data.actionPlans.filter((a: { equipmentCode: string }) => a.equipmentCode === selectedLp.equipmentIdCode).slice(0, 5));
    }).catch(() => {});
  }, [selectedLp]);

  useEffect(() => {
    if (!selectedSampleId) return;
    api.get(`/oil-samples/${selectedSampleId}`).then((r) => setDetail(r.data));
  }, [selectedSampleId]);

  function refreshAfterSave() {
    setShowAddModal(false);
    setShowUploadModal(false);
    if (selectedLp) loadSamples(selectedLp.id);
  }

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{t("nav.oilSampleCenter")}</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowUploadModal(true)} className="flex items-center gap-1.5 text-sm border border-[var(--color-line)] rounded px-3 py-1.5 bg-white hover:bg-[var(--color-canvas)]">
            <Upload size={15} /> Upload Lab Reports (PDF)
          </button>
          <button onClick={() => setShowAddModal(true)} disabled={!selectedLp} className="flex items-center gap-1.5 text-sm rounded px-3 py-1.5 text-white disabled:opacity-40" style={{ background: "var(--color-panel)" }}>
            <Plus size={15} /> Add Sample
          </button>
        </div>
      </div>

      {/* Equipment / LP selector */}
      <div className="relative mb-6 max-w-xl">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)]" />
        <input
          value={selectedLp ? `${selectedLp.lpIdCode} — ${selectedLp.assetName}` : search}
          onChange={(e) => { setSelectedLp(null); setSearch(e.target.value); }}
          onFocus={() => setSelectedLp(null)}
          placeholder="Search equipment or LP ID with oil analysis tracking…"
          className="w-full border border-[var(--color-line)] rounded pl-9 pr-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-signal-blue)]"
        />
        {searchResults.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-[var(--color-line)] rounded shadow-lg max-h-72 overflow-auto">
            {searchResults.map((r) => (
              <button key={r.id} onClick={() => selectLp(r)} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-canvas)] flex items-center gap-2">
                <FlaskConical size={14} className="text-[var(--color-ink-muted)]" />
                <span className="font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)" }}>{r.lpIdCode}</span>
                <span className="text-[var(--color-ink-muted)]">{r.assetName}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!selectedLp && (
        <div className="bg-white rounded-md border border-[var(--color-line)] p-10 text-center text-sm text-[var(--color-ink-muted)]">
          Search for a lubrication point that requires oil analysis to view its sample history.
        </div>
      )}

      {selectedLp && detail && (
        <div className="grid grid-cols-3 gap-5">
          <div className="col-span-2 flex flex-col gap-5">
            {/* Status banner */}
            <div className="rounded-md p-4 flex items-center justify-between" style={{ background: STATUS_BG[detail.reportStatus], color: STATUS_COLOR[detail.reportStatus] }}>
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={18} /> Sample status: {detail.reportStatus}
              </div>
              <span className="text-sm">Sampled {new Date(detail.sampledDate).toLocaleDateString()} · Lab ID {detail.sampleIdLab}</span>
            </div>

            {/* Info panels */}
            <div className="grid grid-cols-3 gap-3">
              <InfoPanel title="Equipment">
                <Field label="Code" value={detail.equipment.code} mono />
                <Field label="Name" value={detail.equipment.name} />
                <Field label="Area" value={detail.equipment.area ?? "—"} />
                <Field label="Contractor" value={detail.equipment.contractor ?? "—"} />
              </InfoPanel>
              <InfoPanel title="Sample">
                <Field label="Lab Sample ID" value={detail.sampleIdLab} mono />
                <Field label="Sampled Date" value={new Date(detail.sampledDate).toLocaleDateString()} />
                <Field label="Uploaded By" value={detail.uploadedBy ?? "—"} />
              </InfoPanel>
              <InfoPanel title="Lubricant">
                <Field label="LP ID" value={detail.lp.lpIdCode} mono />
                <Field label="Type" value={detail.lubricant ?? "—"} />
                <Field label="Description" value={detail.lp.pointDescription} />
              </InfoPanel>
            </div>

            {/* Parameter table grouped */}
            <div className="bg-white rounded-md border border-[var(--color-line)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-3">Parameters</h2>
              <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                {PARAM_GROUP_ORDER.map((group) => {
                  const params = detail.parameterGroups[group];
                  if (!params || params.length === 0) return null;
                  return (
                    <div key={group}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">{PARAM_GROUP_LABELS[group]}</h3>
                      <table className="w-full text-sm">
                        <tbody>
                          {params.map((p) => (
                            <tr key={p.key} className="border-b border-[var(--color-line)] last:border-0">
                              <td className="py-1.5 text-[var(--color-ink-muted)]">{p.label}</td>
                              <td className="py-1.5 text-right font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)" }}>
                                {p.value != null ? `${p.value} ${p.unit ?? ""}` : "—"}
                              </td>
                              <td className="py-1.5 text-right w-20">
                                <span className="status-tag" style={{ color: STATUS_COLOR[p.status], background: STATUS_BG[p.status], fontSize: "0.62rem" }}>{p.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Trend charts */}
            <div className="grid grid-cols-2 gap-3">
              {PARAM_GROUP_ORDER.map((group) => (
                <TrendChart key={group} group={group} trend={trend} />
              ))}
            </div>

            {/* Recommendations */}
            {detail.recommendationsText && (
              <div className="bg-white rounded-md border border-[var(--color-line)] p-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">Recommendations</h2>
                <p className="text-sm">{detail.recommendationsText}</p>
              </div>
            )}
          </div>

          {/* Right column: timeline + last 5 actions */}
          <div className="flex flex-col gap-5">
            <div className="bg-white rounded-md border border-[var(--color-line)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-3">Sample Timeline</h2>
              <div className="flex flex-col gap-1 max-h-80 overflow-auto scrollbar-thin">
                {samples.map((s) => (
                  <button
                    key={s.id} onClick={() => setSelectedSampleId(s.id)}
                    className={`text-left px-2.5 py-2 rounded text-sm flex items-center justify-between ${s.id === selectedSampleId ? "bg-[var(--color-canvas)]" : "hover:bg-[var(--color-canvas)]"}`}
                  >
                    <span>{new Date(s.sampledDate).toLocaleDateString()}</span>
                    <span className="status-tag" style={{ color: STATUS_COLOR[s.reportStatus], background: STATUS_BG[s.reportStatus], fontSize: "0.62rem" }}>{s.reportStatus}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-md border border-[var(--color-line)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-3">Last 5 Actions</h2>
              <div className="flex flex-col gap-2">
                {lastActions.map((a) => (
                  <div key={a.id} className="text-sm border-b border-[var(--color-line)] last:border-0 pb-2">
                    <div className="font-medium">{a.actionType}</div>
                    <div className="text-[var(--color-ink-muted)] text-xs">{a.description}</div>
                    <div className="text-xs text-[var(--color-ink-muted)] mt-0.5">{a.status} · {new Date(a.createdAt).toLocaleDateString()}</div>
                  </div>
                ))}
                {lastActions.length === 0 && <p className="text-sm text-[var(--color-ink-muted)]">No recent actions for this equipment.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddModal && selectedLp && (
        <AddSampleModal lpId={selectedLp.id} onClose={() => setShowAddModal(false)} onSaved={refreshAfterSave} />
      )}
      {showUploadModal && (
        <UploadPdfModal onClose={() => setShowUploadModal(false)} onSaved={refreshAfterSave} />
      )}
    </div>
  );
}

function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-md border border-[var(--color-line)] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--color-ink-muted)]">{label}</span>
      <span className={mono ? "font-[var(--font-mono)]" : ""} style={mono ? { fontFamily: "var(--font-mono)" } : undefined}>{value}</span>
    </div>
  );
}

const GROUP_COLORS = ["#c8442c", "#d68f1f", "#3e7c59", "#2d6ca8", "#8a5cb8", "#5c5850"];

function TrendChart({ group, trend }: { group: string; trend: { sampledDate: string; values: { key: string; value: number | null; status: string }[] }[] }) {
  const keysInGroup = OIL_SAMPLE_PARAMETERS.filter((p) => p.group === group).map((p) => p.key);
  const data = trend.map((point) => {
    const row: Record<string, string | number | null> = { date: new Date(point.sampledDate).toLocaleDateString() };
    for (const v of point.values) if (keysInGroup.includes(v.key)) row[v.key] = v.value;
    return row;
  });
  const presentKeys = keysInGroup.filter((k) => data.some((d) => d[k] != null));
  if (presentKeys.length === 0) return null;

  return (
    <div className="bg-white rounded-md border border-[var(--color-line)] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">{PARAM_GROUP_LABELS[group]} Trend</h3>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {presentKeys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={GROUP_COLORS[i % GROUP_COLORS.length]} strokeWidth={1.5} dot={{ r: 2 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Manual entry modal ──────────────────────────────────────────────────────

function AddSampleModal({ lpId, onClose, onSaved }: { lpId: string; onClose: () => void; onSaved: () => void }) {
  const [sampleIdLab, setSampleIdLab] = useState("");
  const [sampledDate, setSampledDate] = useState(new Date().toISOString().slice(0, 10));
  const [recommendationsText, setRecommendationsText] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const parameters = OIL_SAMPLE_PARAMETERS
        .filter((p) => values[p.key])
        .map((p) => ({ key: p.key, value: parseFloat(values[p.key]) }));
      await api.post("/oil-samples", { lpId, sampleIdLab, sampledDate, recommendationsText: recommendationsText || null, parameters });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-md p-6 w-full max-w-2xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-4" style={{ fontFamily: "var(--font-display)" }}>Add oil sample</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className="flex flex-col gap-1 text-sm">
            Lab Sample ID
            <input value={sampleIdLab} onChange={(e) => setSampleIdLab(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Sampled Date
            <input type="date" value={sampledDate} onChange={(e) => setSampledDate(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-4">
          {PARAM_GROUP_ORDER.map((group) => (
            <div key={group}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5">{PARAM_GROUP_LABELS[group]}</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {OIL_SAMPLE_PARAMETERS.filter((p) => p.group === group).map((p) => (
                  <label key={p.key} className="flex flex-col gap-0.5 text-xs">
                    {p.label}
                    <input
                      type="number" step="0.01" value={values[p.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                      className="border border-[var(--color-line)] rounded px-2 py-1 text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm mb-4">
          Recommendations
          <textarea value={recommendationsText} onChange={(e) => setRecommendationsText(e.target.value)} rows={2} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" />
        </label>
        {error && <p className="text-sm mb-3" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">Cancel</button>
          <button onClick={save} disabled={!sampleIdLab || saving} className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: "var(--color-panel)" }}>
            Save sample
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Batch PDF upload + mandatory review modal ───────────────────────────────

interface ExtractedSample {
  fileName: string;
  matchedEquipmentCode: string | null;
  matchedLpId: string | null;
  sampleIdLab: string | null;
  sampledDate: string | null;
  parameters: { key: string; value: number | null; status: string }[];
  isDuplicate: boolean;
  warning?: string;
}

function UploadPdfModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [files, setFiles] = useState<FileList | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [results, setResults] = useState<ExtractedSample[]>([]);
  const [savedIndexes, setSavedIndexes] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function extract() {
    if (!files || files.length === 0) return;
    setError(null);
    setExtracting(true);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      const res = await api.post("/oil-samples/extract-pdf", form, { headers: { "Content-Type": "multipart/form-data" } });
      setResults(res.data.results);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setExtracting(false);
    }
  }

  async function saveOne(index: number) {
    const r = results[index];
    if (!r.matchedLpId || !r.sampleIdLab || !r.sampledDate) return;
    try {
      await api.post("/oil-samples", {
        lpId: r.matchedLpId, sampleIdLab: r.sampleIdLab, sampledDate: r.sampledDate,
        parameters: r.parameters.filter((p) => p.value != null),
      });
      setSavedIndexes((s) => new Set(s).add(index));
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-md p-6 w-full max-w-3xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-1" style={{ fontFamily: "var(--font-display)" }}>Upload lab report PDFs</h3>
        <p className="text-sm text-[var(--color-ink-muted)] mb-4">Every extracted sample requires review before it's saved — nothing is imported automatically.</p>

        {results.length === 0 && (
          <>
            <input type="file" accept="application/pdf" multiple onChange={(e) => setFiles(e.target.files)} className="text-sm mb-4" />
            {error && <p className="text-sm mb-3" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">Cancel</button>
              <button onClick={extract} disabled={!files || extracting} className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: "var(--color-panel)" }}>
                {extracting ? "Extracting…" : "Extract"}
              </button>
            </div>
          </>
        )}

        {results.length > 0 && (
          <div className="flex flex-col gap-3">
            {results.map((r, i) => (
              <div key={i} className="border border-[var(--color-line)] rounded p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{r.fileName}</span>
                  {savedIndexes.has(i) ? (
                    <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--color-signal-green-bg)", color: "var(--color-signal-green)" }}>Saved</span>
                  ) : r.isDuplicate ? (
                    <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--color-signal-gray-bg)", color: "var(--color-signal-gray)" }}>Duplicate — skipped</span>
                  ) : (
                    <button
                      onClick={() => saveOne(i)} disabled={!r.matchedLpId || !r.sampleIdLab || !r.sampledDate}
                      className="text-xs px-2.5 py-1 rounded text-white disabled:opacity-40" style={{ background: "var(--color-panel)" }}
                    >
                      Confirm &amp; Save
                    </button>
                  )}
                </div>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {r.matchedEquipmentCode ? `Matched: ${r.matchedEquipmentCode}` : "No equipment match"}
                  {r.sampleIdLab && ` · Sample ID ${r.sampleIdLab}`}
                  {r.sampledDate && ` · ${r.sampledDate}`}
                  {` · ${r.parameters.length} parameter(s) found`}
                </p>
                {r.warning && <p className="text-xs mt-1" style={{ color: "var(--color-signal-amber)" }}>{r.warning}</p>}
              </div>
            ))}
            <div className="flex justify-end mt-2">
              <button onClick={() => { onSaved(); }} className="text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
