import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface TimelineEvent {
  id: string;
  timestamp: string;
  eventType: string;
  lpId: string | null;
  lpIdCode: string | null;
  equipmentName: string | null;
  areaName: string | null;
  contractor: string | null;
  actor: string | null;
  detail: string;
}

const EVENT_TYPES: { value: string; label: string; color: string; bg: string }[] = [
  { value: "LUBRICATION_COMPLETED", label: "Lubrication Completed", color: "var(--color-signal-blue)", bg: "var(--color-signal-blue-bg)" },
  { value: "APPROVED", label: "Approved", color: "var(--color-signal-green)", bg: "var(--color-signal-green-bg)" },
  { value: "REJECTED", label: "Rejected", color: "var(--color-signal-red)", bg: "var(--color-signal-red-bg)" },
  { value: "OVERDUE_FLAGGED", label: "Overdue Flagged", color: "var(--color-signal-red)", bg: "var(--color-signal-red-bg)" },
  { value: "OIL_SAMPLE_COMPLETED", label: "Oil Sample Completed", color: "var(--color-signal-blue)", bg: "var(--color-signal-blue-bg)" },
  { value: "OIL_SAMPLE_OVERDUE_FLAGGED", label: "Oil Sample Overdue Flagged", color: "var(--color-signal-red)", bg: "var(--color-signal-red-bg)" },
  { value: "ACTION_CREATED", label: "Action Created", color: "var(--color-signal-amber)", bg: "var(--color-signal-amber-bg)" },
  { value: "ACTION_CLOSED", label: "Action Closed", color: "var(--color-signal-green)", bg: "var(--color-signal-green-bg)" },
  { value: "ACC_DATA_EDIT", label: "ACC Data Edit", color: "var(--color-signal-gray)", bg: "var(--color-signal-gray-bg)" },
];
const EVENT_TYPE_MAP = Object.fromEntries(EVENT_TYPES.map((t) => [t.value, t]));

export function TimelinePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [equipmentList, setEquipmentList] = useState<{ id: string; code: string; name: string }[]>([]);
  const [technicians, setTechnicians] = useState<{ id: string; name: string }[]>([]);
  const [contractors, setContractors] = useState<{ id: string; name: string }[]>([]);

  const [areaFilter, setAreaFilter] = useState("");
  const [equipmentFilter, setEquipmentFilter] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [technicianFilter, setTechnicianFilter] = useState("");
  const [contractorFilter, setContractorFilter] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    api.get("/lookups/areas").then((r) => setAreas(r.data.areas));
    api.get("/lookups/equipment").then((r) => setEquipmentList(r.data.equipment));
    api.get("/lookups/technicians").then((r) => setTechnicians(r.data.technicians));
    if (user?.dataScope === "ALL_ORGS") {
      api.get("/lookups/organizations").then((r) => setContractors(r.data.organizations.filter((o: { type: string }) => o.type === "CONTRACTOR")));
    }
  }, [user]);

  useEffect(() => {
    setLoading(true);
    api.get("/timeline", {
      params: {
        area: areaFilter || undefined, equipment: equipmentFilter || undefined, eventType: eventTypeFilter || undefined,
        technician: technicianFilter || undefined, contractor: contractorFilter || undefined, from, to,
      },
    }).then((r) => setEvents(r.data.events)).finally(() => setLoading(false));
  }, [areaFilter, equipmentFilter, eventTypeFilter, technicianFilter, contractorFilter, from, to]);

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "var(--font-display)" }}>{t("nav.timeline")}</h1>
      <p className="text-sm text-[var(--color-ink-muted)] mb-5">The full plant-wide activity feed. For ACC data corrections and admin/settings changes specifically, see the Audit Log in Settings.</p>

      <div className="flex flex-wrap gap-2 mb-5">
        <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="border border-[var(--color-line)] rounded px-2.5 py-1.5 text-sm bg-white">
          <option value="">{t("explorer.allAreas")}</option>
          {areas.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        <select value={equipmentFilter} onChange={(e) => setEquipmentFilter(e.target.value)} className="border border-[var(--color-line)] rounded px-2.5 py-1.5 text-sm bg-white">
          <option value="">All Equipment</option>
          {equipmentList.map((e) => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
        </select>
        <select value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value)} className="border border-[var(--color-line)] rounded px-2.5 py-1.5 text-sm bg-white">
          <option value="">All Event Types</option>
          {EVENT_TYPES.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
        </select>
        <select value={technicianFilter} onChange={(e) => setTechnicianFilter(e.target.value)} className="border border-[var(--color-line)] rounded px-2.5 py-1.5 text-sm bg-white">
          <option value="">All Technicians</option>
          {technicians.map((tc) => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
        </select>
        {user?.dataScope === "ALL_ORGS" && (
          <select value={contractorFilter} onChange={(e) => setContractorFilter(e.target.value)} className="border border-[var(--color-line)] rounded px-2.5 py-1.5 text-sm bg-white">
            <option value="">{t("explorer.allContractors")}</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-[var(--color-line)] rounded px-2.5 py-1.5 text-sm bg-white" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-[var(--color-line)] rounded px-2.5 py-1.5 text-sm bg-white" />
      </div>

      <div className="bg-white rounded-md border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
        {!loading && events.map((ev) => {
          const meta = EVENT_TYPE_MAP[ev.eventType];
          const clickable = !!ev.lpId;
          return (
            <div
              key={ev.id} onClick={() => clickable && navigate(`/explorer/${ev.lpId}`)}
              className={`px-4 py-3 flex items-start gap-3 ${clickable ? "cursor-pointer hover:bg-[var(--color-canvas)]" : ""}`}
            >
              <span className="status-tag shrink-0 mt-0.5" style={{ color: meta?.color, background: meta?.bg, fontSize: "0.62rem" }}>{meta?.label ?? ev.eventType}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm flex items-center gap-2 flex-wrap">
                  {ev.lpIdCode && <span className="font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)" }}>{ev.lpIdCode}</span>}
                  <span className="text-[var(--color-ink-muted)]">{ev.equipmentName}</span>
                  {ev.areaName && <span className="text-[var(--color-ink-muted)] text-xs">· {ev.areaName}</span>}
                </div>
                <p className="text-sm mt-0.5">{ev.detail}</p>
                <p className="text-xs text-[var(--color-ink-muted)] mt-0.5">
                  {ev.actor ?? "—"} · {new Date(ev.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
        {!loading && events.length === 0 && <p className="p-8 text-center text-sm text-[var(--color-ink-muted)]">No events in this range.</p>}
        {loading && <p className="p-8 text-center text-sm text-[var(--color-ink-muted)]">{t("common.loading")}</p>}
      </div>
    </div>
  );
}
