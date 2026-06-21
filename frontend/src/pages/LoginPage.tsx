import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { apiErrorMessage } from "../lib/api";

export function LoginPage() {
  const { t } = useTranslation();
  const { login, mustChangePassword, clearMustChangePassword, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      setError(t("login.invalidCredentials"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t("login.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/change-password", { currentPassword: password, newPassword });
      clearMustChangePassword();
      await refreshUser();
      navigate("/dashboard");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-panel)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-block w-12 h-12 rounded mb-4" style={{ background: "var(--color-signal-amber)" }} />
          <h1 className="text-white text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>{t("app.name")}</h1>
          <p className="text-white/50 text-sm mt-1">{t("login.subtitle")}</p>
        </div>

        <div className="bg-white rounded-md p-6 shadow-xl">
          {!mustChangePassword ? (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <h2 className="font-semibold text-lg" style={{ fontFamily: "var(--font-display)" }}>{t("login.title")}</h2>
              <label className="flex flex-col gap-1 text-sm">
                {t("login.email")}
                <input
                  type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="border border-[var(--color-line)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-signal-blue)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("login.password")}
                <input
                  type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  className="border border-[var(--color-line)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-signal-blue)]"
                />
              </label>
              {error && <p className="text-sm" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
              <button
                type="submit" disabled={submitting}
                className="mt-1 rounded px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--color-panel)" }}
              >
                {t("login.signIn")}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSetPassword} className="flex flex-col gap-4">
              <h2 className="font-semibold text-lg" style={{ fontFamily: "var(--font-display)" }}>{t("login.forcedChangeTitle")}</h2>
              <p className="text-sm text-[var(--color-ink-muted)]">{t("login.forcedChangeSubtitle")}</p>
              <label className="flex flex-col gap-1 text-sm">
                {t("login.newPassword")}
                <input
                  type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  className="border border-[var(--color-line)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-signal-blue)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("login.confirmPassword")}
                <input
                  type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  className="border border-[var(--color-line)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-signal-blue)]"
                />
              </label>
              {error && <p className="text-sm" style={{ color: "var(--color-signal-red)" }}>{error}</p>}
              <button
                type="submit" disabled={submitting}
                className="mt-1 rounded px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--color-panel)" }}
              >
                {t("login.setPassword")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
