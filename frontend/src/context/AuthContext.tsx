import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import type { AuthUser } from "../types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  clearMustChangePassword: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  async function refreshUser() {
    try {
      const res = await api.get("/auth/me");
      setUser(res.data.user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    const token = localStorage.getItem("acc_oil_token");
    if (!token) {
      setLoading(false);
      return;
    }
    refreshUser().finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post("/auth/login", { email, password });
    localStorage.setItem("acc_oil_token", res.data.token);
    setMustChangePassword(!!res.data.mustChangePassword);
    await refreshUser();
  }

  function logout() {
    localStorage.removeItem("acc_oil_token");
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, mustChangePassword, login, logout, refreshUser, clearMustChangePassword: () => setMustChangePassword(false) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
