import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExplorerPage } from "./pages/ExplorerPage";
import { LpDetailsPage } from "./pages/LpDetailsPage";
import { PendingApprovalsPage } from "./pages/PendingApprovalsPage";
import { ActionPlansPage } from "./pages/ActionPlansPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ComingSoonPage } from "./pages/ComingSoonPage";

function ProtectedRoutes() {
  const { user, loading, mustChangePassword } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-[var(--color-ink-muted)]">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/login" replace />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/explorer" element={<ExplorerPage />} />
        <Route path="/explorer/:id" element={<LpDetailsPage />} />
        <Route path="/approvals" element={<PendingApprovalsPage />} />
        <Route path="/action-plans" element={<ActionPlansPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/routes" element={<ComingSoonPage titleKey="nav.routeCenter" />} />
        <Route path="/timeline" element={<ComingSoonPage titleKey="nav.timeline" />} />
        <Route path="/oil-samples" element={<ComingSoonPage titleKey="nav.oilSampleCenter" />} />
        <Route path="/oil-management" element={<ComingSoonPage titleKey="nav.oilManagement" />} />
        <Route path="/reports" element={<ComingSoonPage titleKey="nav.reports" />} />
        <Route path="/settings" element={<ComingSoonPage titleKey="nav.settings" />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}
