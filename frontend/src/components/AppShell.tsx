import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, ListTree, Route as RouteIcon, ClipboardCheck, History,
  FlaskConical, Droplets, ListChecks, Bell, FileBarChart, Settings as SettingsIcon, LogOut,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { applyLanguage } from "../i18n";

interface NavItem {
  to: string;
  screenKey: string;
  icon: typeof LayoutDashboard;
  labelKey: string;
  countKey?: "totalLubricationPoints" | "pendingApproval" | "openActionPlans" | "unreadNotifications";
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", screenKey: "dashboard", icon: LayoutDashboard, labelKey: "nav.dashboard", countKey: "totalLubricationPoints" },
  { to: "/explorer", screenKey: "lubrication_explorer", icon: ListTree, labelKey: "nav.explorer" },
  { to: "/routes", screenKey: "route_center", icon: RouteIcon, labelKey: "nav.routeCenter" },
  { to: "/approvals", screenKey: "pending_approvals", icon: ClipboardCheck, labelKey: "nav.pendingApprovals", countKey: "pendingApproval" },
  { to: "/timeline", screenKey: "lubrication_timeline", icon: History, labelKey: "nav.timeline" },
  { to: "/oil-samples", screenKey: "oil_sample_center", icon: FlaskConical, labelKey: "nav.oilSampleCenter" },
  { to: "/oil-management", screenKey: "oil_management_center", icon: Droplets, labelKey: "nav.oilManagement" },
  { to: "/action-plans", screenKey: "action_plan_center", icon: ListChecks, labelKey: "nav.actionPlans", countKey: "openActionPlans" },
  { to: "/notifications", screenKey: "notification_center", icon: Bell, labelKey: "nav.notifications", countKey: "unreadNotifications" },
  { to: "/reports", screenKey: "reports_center", icon: FileBarChart, labelKey: "nav.reports" },
  { to: "/settings", screenKey: "settings", icon: SettingsIcon, labelKey: "nav.settings" },
];

export function AppShell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user) return;
    applyLanguage(user.languagePref);
    api.get("/dashboard/kpis").then((r) => {
      setCounts((c) => ({ ...c, totalLubricationPoints: r.data.totalLubricationPoints, pendingApproval: r.data.pendingApproval, openActionPlans: r.data.openActionPlans }));
    }).catch(() => {});
    api.get("/notifications", { params: { status: "UNREAD" } }).then((r) => {
      setCounts((c) => ({ ...c, unreadNotifications: r.data.unreadCount }));
    }).catch(() => {});
  }, [user]);

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--color-canvas)" }}>
      <aside className="w-64 shrink-0 flex flex-col" style={{ background: "var(--color-panel)" }}>
        <div className="px-5 py-5 border-b border-white/10">
          <div className="font-bold text-white text-lg leading-tight" style={{ fontFamily: "var(--font-display)" }}>
            {t("app.name")}
          </div>
          <div className="text-xs text-white/50 mt-0.5">{t("app.companyName")}</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 scrollbar-thin">
          {NAV_ITEMS.filter((item) => user.screenAccess[item.screenKey]).map((item) => {
            const Icon = item.icon;
            const count = item.countKey ? counts[item.countKey] : undefined;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center justify-between mx-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                    isActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                  }`
                }
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={17} strokeWidth={2} />
                  {t(item.labelKey)}
                </span>
                {count !== undefined && (
                  <span className="font-[var(--font-mono)] text-xs px-1.5 py-0.5 rounded bg-white/10" style={{ fontFamily: "var(--font-mono)" }}>
                    {count}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="px-3 py-3 border-t border-white/10">
          <div className="px-2 py-1.5 mb-1">
            <div className="text-sm text-white font-medium truncate">{user.name}</div>
            <div className="text-xs text-white/50 truncate">{user.titleName} · {user.organizationName ?? "All Orgs"}</div>
          </div>
          <button
            onClick={() => { logout(); navigate("/login"); }}
            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm text-white/70 hover:bg-white/5 hover:text-white"
          >
            <LogOut size={16} /> {t("common.signOut")}
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
