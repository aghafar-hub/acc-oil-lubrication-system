import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { PriorityTag } from "../components/StatusTag";

interface NotificationRow {
  id: string;
  type: string;
  message: string;
  priority: string;
  status: string;
  createdAt: string;
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.get("/notifications").then((r) => setNotifications(r.data.notifications)).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function markRead(id: string) {
    await api.patch(`/notifications/${id}/read`);
    load();
  }
  async function markAllRead() {
    await api.patch("/notifications/mark-all-read");
    load();
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{t("nav.notifications")}</h1>
        <button onClick={markAllRead} className="text-sm text-[var(--color-signal-blue)] hover:underline">Mark all as read</button>
      </div>
      <div className="flex flex-col gap-2">
        {!loading && notifications.map((n) => (
          <div
            key={n.id} onClick={() => n.status === "UNREAD" && markRead(n.id)}
            className="bg-white rounded-md border border-[var(--color-line)] p-3.5 flex items-start gap-3 cursor-pointer"
            style={{ opacity: n.status === "UNREAD" ? 1 : 0.6 }}
          >
            <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: n.status === "UNREAD" ? "var(--color-signal-blue)" : "transparent" }} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-medium">{n.type}</span>
                <PriorityTag priority={n.priority} />
              </div>
              <p className="text-sm text-[var(--color-ink-muted)]">{n.message}</p>
              <p className="text-xs text-[var(--color-ink-muted)] mt-1">{new Date(n.createdAt).toLocaleString()}</p>
            </div>
          </div>
        ))}
        {!loading && notifications.length === 0 && <p className="text-sm text-[var(--color-ink-muted)] p-4">No notifications.</p>}
        {loading && <p className="text-sm text-[var(--color-ink-muted)] p-4">{t("common.loading")}</p>}
      </div>
    </div>
  );
}
