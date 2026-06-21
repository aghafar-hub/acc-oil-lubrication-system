import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:4000/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("acc_oil_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("acc_oil_token");
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) return err.response?.data?.error || err.message || fallback;
  return fallback;
}
