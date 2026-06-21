import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../context/AuthContext";

type Tab = "users" | "permissions" | "notifications" | "auditLog" | "general";

export function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("users");

  const TABS: { key: Tab; label: string; show: boolean }[] = [
    { key: "users", label: "Users & Roles", show: !!user?.capabilities.manageUsers },
    { key: "permissions", label: "Permission Templates", show: !!user?.capabilities.managePermissions },
    { key: "notifications", label: "Notification Routing", show: !!user?.capabilities.manageNotificationRouting },
    { key: "auditLog", label: "Audit Log", show: true },
    { key: "general", label: "General", show: !!user?.capabilities.manageSettings },
  ];
  const visibleTabs = TABS.filter((tb) => tb.show);

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: "var(--font-display)" }}>{t("nav.settings")}</h1>
      <div className="flex gap-1 border-b border-[var(--color-line)] mb-5">
        {visibleTabs.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === tb.key ? "border-[var(--color-panel)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-ink-muted)]"}`}>
            {tb.label}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "permissions" && <PermissionsTab />}
      {tab === "notifications" && <NotificationRoutingTab />}
      {tab === "auditLog" && <AuditLogTab />}
      {tab === "general" && <GeneralTab />}
    </div>
  );
}

// ── Users & Roles ────────────────────────────────────────────────────────────

interface UserRow { id: string; name: string; email: string; title: string | null; organization: string | null; active: boolean }
interface TitleOption { id: string; name: string }

function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [titles, setTitles] = useState<TitleOption[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get("/users").then((r) => setUsers(r.data.users));
    api.get("/users/titles").then((r) => setTitles(r.data.titles));
  }
  useEffect(() => { load(); }, []);

  async function toggleActive(u: UserRow) {
    setError(null);
    try {
      await api.patch(`/users/${u.id}/active`, { active: !u.active });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button onClick={() => setShowAdd(true)} className="self-end flex items-center gap-1.5 text-sm rounded px-3 py-1.5 text-white" style={{ background: "var(--color-panel)" }}>
        <Plus size={15} /> Add User
      </button>
      {error && <p className="text-sm" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
      <div className="bg-white rounded-md border border-[var(--color-line)] overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)] border-b border-[var(--color-line)]">
              <th className="px-3 py-2.5 font-medium">Name</th>
              <th className="px-3 py-2.5 font-medium">Email</th>
              <th className="px-3 py-2.5 font-medium">Title</th>
              <th className="px-3 py-2.5 font-medium">Organization</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--color-line)] last:border-0">
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2 text-[var(--color-ink-muted)]">{u.email}</td>
                <td className="px-3 py-2">{u.title}</td>
                <td className="px-3 py-2">{u.organization ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: u.active ? "var(--color-signal-green-bg)" : "var(--color-signal-gray-bg)", color: u.active ? "var(--color-signal-green)" : "var(--color-signal-gray)" }}>
                    {u.active ? "Active" : "Deactivated"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => toggleActive(u)} className="text-xs text-[var(--color-signal-blue)] hover:underline">
                    {u.active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddUserModal titles={titles} onClose={() => setShowAdd(false)} onCreated={(email, password) => { setShowAdd(false); setTempPassword({ email, password }); load(); }} />
      )}
      {tempPassword && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setTempPassword(null)}>
          <div className="bg-white rounded-md p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-2" style={{ fontFamily: "var(--font-display)" }}>User created</h3>
            <p className="text-sm text-[var(--color-ink-muted)] mb-3">Share this temporary password with {tempPassword.email} — it won't be shown again. They'll be required to change it on first sign-in.</p>
            <div className="font-[var(--font-mono)] text-sm bg-[var(--color-canvas)] rounded px-3 py-2 mb-4" style={{ fontFamily: "var(--font-mono)" }}>{tempPassword.password}</div>
            <button onClick={() => setTempPassword(null)} className="w-full text-sm px-3 py-1.5 rounded text-white" style={{ background: "var(--color-panel)" }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddUserModal({ titles, onClose, onCreated }: { titles: TitleOption[]; onClose: () => void; onCreated: (email: string, password: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [titleId, setTitleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await api.post("/users", { name, email, titleId, organizationId: null });
      onCreated(email, res.data.temporaryPassword);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-md p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-4" style={{ fontFamily: "var(--font-display)" }}>Add user</h3>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">Name<input value={name} onChange={(e) => setName(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" /></label>
          <label className="flex flex-col gap-1 text-sm">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm" /></label>
          <label className="flex flex-col gap-1 text-sm">
            Title
            <select value={titleId} onChange={(e) => setTitleId(e.target.value)} className="border border-[var(--color-line)] rounded px-3 py-2 text-sm">
              <option value="">Select…</option>
              {titles.map((tl) => <option key={tl.id} value={tl.id}>{tl.name}</option>)}
            </select>
          </label>
          {error && <p className="text-sm" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-[var(--color-line)]">Cancel</button>
            <button onClick={save} disabled={!name || !email || !titleId || saving} className="text-sm px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: "var(--color-panel)" }}>Create</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Permission Templates ─────────────────────────────────────────────────────

interface TemplateRow { id: string; name: string; dataScope: string; screenAccess: Record<string, boolean>; capabilities: Record<string, boolean>; titles: string[] }

function PermissionsTab() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [selected, setSelected] = useState<TemplateRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get("/settings/permission-templates").then((r) => setTemplates(r.data.templates));
  }
  useEffect(() => { load(); }, []);

  function toggle(field: "screenAccess" | "capabilities", key: string) {
    if (!selected) return;
    setSelected({ ...selected, [field]: { ...selected[field], [key]: !selected[field][key] } });
  }

  async function save() {
    if (!selected) return;
    setError(null);
    setSaving(true);
    try {
      await api.patch(`/settings/permission-templates/${selected.id}`, { screenAccess: selected.screenAccess, capabilities: selected.capabilities });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-5">
      <div className="bg-white rounded-md border border-[var(--color-line)] p-2 flex flex-col gap-0.5 h-fit">
        {templates.map((tpl) => (
          <button key={tpl.id} onClick={() => setSelected(tpl)}
            className={`text-left px-3 py-2 rounded text-sm ${selected?.id === tpl.id ? "bg-[var(--color-canvas)] font-medium" : "hover:bg-[var(--color-canvas)]"}`}>
            {tpl.name}
            <div className="text-xs text-[var(--color-ink-muted)]">{tpl.dataScope === "ALL_ORGS" ? "All organizations" : "Own organization"}</div>
          </button>
        ))}
      </div>
      <div className="col-span-2">
        {!selected && <div className="bg-white rounded-md border border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-ink-muted)]">Select a title to edit its access.</div>}
        {selected && (
          <div className="bg-white rounded-md border border-[var(--color-line)] p-5">
            <h3 className="font-semibold mb-4" style={{ fontFamily: "var(--font-display)" }}>{selected.name}</h3>
            <p className="text-xs text-[var(--color-ink-muted)] mb-4">Changes here apply only to {selected.name} — every other title keeps its own independent settings.</p>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">Screens</h4>
                <div className="flex flex-col gap-1.5">
                  {Object.keys(selected.screenAccess).map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selected.screenAccess[key]} onChange={() => toggle("screenAccess", key)} />
                      {key.replace(/_/g, " ")}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">Capabilities</h4>
                <div className="flex flex-col gap-1.5">
                  {Object.keys(selected.capabilities).map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selected.capabilities[key]} onChange={() => toggle("capabilities", key)} />
                      {key}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {error && <p className="text-sm mt-3" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
            <button onClick={save} disabled={saving} className="mt-4 text-sm px-3 py-1.5 rounded text-white disabled:opacity-50" style={{ background: "var(--color-panel)" }}>
              Save changes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Notification Routing ─────────────────────────────────────────────────────

interface NotifTypeRow { id: string; name: string; defaultPriority: string; rule: { id: string; recipientTokens: string[]; channels: string[] } | null }
const ALL_TOKENS = ["OWN_ORG_TECHNICIAN", "OWN_ORG_ENGINEER", "OWN_ORG_MANAGER", "ACC_ENGINEER", "ACC_MANAGER", "SUPER_ADMIN"];

function NotificationRoutingTab() {
  const [types, setTypes] = useState<NotifTypeRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get("/settings/notification-routing").then((r) => setTypes(r.data.types));
  }
  useEffect(() => { load(); }, []);

  async function toggleToken(t: NotifTypeRow, token: string) {
    if (!t.rule) return;
    const tokens = t.rule.recipientTokens.includes(token) ? t.rule.recipientTokens.filter((x) => x !== token) : [...t.rule.recipientTokens, token];
    setError(null);
    try {
      await api.patch(`/settings/notification-routing/${t.rule.id}`, { recipientTokens: tokens });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="bg-white rounded-md border border-[var(--color-line)] overflow-auto">
      {error && <p className="text-sm p-3" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)] border-b border-[var(--color-line)]">
            <th className="px-3 py-2.5 font-medium">Notification Type</th>
            {ALL_TOKENS.map((tk) => <th key={tk} className="px-2 py-2.5 font-medium text-center" style={{ writingMode: "vertical-rl" }}>{tk.replace(/_/g, " ")}</th>)}
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id} className="border-b border-[var(--color-line)] last:border-0">
              <td className="px-3 py-2">{t.name}</td>
              {ALL_TOKENS.map((tk) => (
                <td key={tk} className="px-2 py-2 text-center">
                  <input type="checkbox" checked={!!t.rule?.recipientTokens.includes(tk)} onChange={() => toggleToken(t, tk)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

interface AuditEntry { id: string; actor: string; actionCategory: string; entityType: string; entityId: string; reason: string | null; timestamp: string }

function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  useEffect(() => { api.get("/audit-log").then((r) => setEntries(r.data.entries)); }, []);

  return (
    <div className="bg-white rounded-md border border-[var(--color-line)] overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)] border-b border-[var(--color-line)]">
            <th className="px-3 py-2.5 font-medium">Timestamp</th>
            <th className="px-3 py-2.5 font-medium">Actor</th>
            <th className="px-3 py-2.5 font-medium">Action</th>
            <th className="px-3 py-2.5 font-medium">Entity</th>
            <th className="px-3 py-2.5 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-[var(--color-line)] last:border-0">
              <td className="px-3 py-2 text-[var(--color-ink-muted)]">{new Date(e.timestamp).toLocaleString()}</td>
              <td className="px-3 py-2">{e.actor}</td>
              <td className="px-3 py-2">{e.actionCategory}</td>
              <td className="px-3 py-2 font-[var(--font-mono)]" style={{ fontFamily: "var(--font-mono)" }}>{e.entityType} #{e.entityId.slice(0, 8)}</td>
              <td className="px-3 py-2 text-[var(--color-ink-muted)]">{e.reason ?? "—"}</td>
            </tr>
          ))}
          {entries.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-[var(--color-ink-muted)]">No audit entries yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── General settings ────────────────────────────────────────────────────────

interface SettingRow { key: string; value: string; editableByTitle: string | null }

function GeneralTab() {
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get("/settings").then((r) => setSettings(r.data.settings));
  }
  useEffect(() => { load(); }, []);

  async function save(key: string) {
    setError(null);
    try {
      await api.patch(`/settings/${key}`, { value: edited[key] });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="bg-white rounded-md border border-[var(--color-line)] p-5">
      {error && <p className="text-sm mb-3" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
      <div className="flex flex-col gap-3">
        {settings.map((s) => (
          <div key={s.key} className="flex items-center gap-3">
            <span className="text-sm w-72 shrink-0 text-[var(--color-ink-muted)]">{s.key}</span>
            <input
              value={edited[s.key] ?? s.value}
              onChange={(e) => setEdited((v) => ({ ...v, [s.key]: e.target.value }))}
              className="flex-1 border border-[var(--color-line)] rounded px-3 py-1.5 text-sm font-[var(--font-mono)]"
              style={{ fontFamily: "var(--font-mono)" }}
            />
            <button onClick={() => save(s.key)} className="text-xs px-2.5 py-1.5 rounded border border-[var(--color-line)] hover:bg-[var(--color-canvas)]">Save</button>
          </div>
        ))}
      </div>
    </div>
  );
}
