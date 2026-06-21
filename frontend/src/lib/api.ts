/**
 * ACC Oil Lubrication System — Apps Script API client
 * ====================================================
 *
 * Replaces the old axios instance that talked to the Express backend. This
 * file is a drop-in replacement: every page in the app still calls
 * `api.get(url, { params })`, `api.post(url, body)`, `api.patch(url, body)`,
 * and reads `res.data...` exactly as before, and `apiErrorMessage(err)`
 * still works the same way. Nothing outside this file needed to change.
 *
 * Under the hood, every call is translated into a single Google Apps
 * Script Web App request: { fn: "<function name>", token, params }. See
 * ROUTES below for the full REST-path -> fn-name mapping.
 *
 * WHY NOT REAL REST CALLS TO THE WEB APP? Two CORS landmines:
 *   1. A custom `Authorization` header on a cross-origin request triggers a
 *      preflight OPTIONS request, which Apps Script Web Apps do not handle.
 *      -> the session token travels in the request body/query instead.
 *   2. `Content-Type: application/json` on a POST also triggers a
 *      preflight. -> POST bodies are sent as plain strings (the browser's
 *      default `text/plain` content type for a string body), and the Apps
 *      Script side parses the JSON manually from e.postData.contents.
 * Both are handled here so every other file in the app stays untouched.
 */

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbyEaJfrkv7zBUuXORkG_KgSnvUvxPbd25cRUehwrNDKZtWdW0M1bhhrCqZnY7p88mxtQg/exec";

const TOKEN_KEY = "acc_oil_token";

// ---------------------------------------------------------------------------
// Route table: REST-shaped (method, path) -> Apps Script function name.
// `:param` segments are extracted and merged into the params object sent to
// the function, alongside query params (GET) or the request body (POST/PATCH).
// ---------------------------------------------------------------------------

interface RouteDef {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  pattern: RegExp;
  paramNames: string[];
  fn: string;
  /** Optional remap of extracted path params before merging, e.g. :id -> routeId. */
  remap?: Record<string, string>;
  /** Optional fixed params merged in for routes that share an fn but need a discriminator, e.g. metric: "kpis". */
  fixed?: Record<string, string>;
}

function compile(method: RouteDef["method"], path: string, fn: string, opts?: { remap?: Record<string, string>; fixed?: Record<string, string> }): RouteDef {
  const paramNames: string[] = [];
  const pattern = new RegExp(
    "^" +
      path
        .split("/")
        .map((seg) => {
          if (seg.startsWith(":")) {
            paramNames.push(seg.slice(1));
            return "([^/]+)";
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/") +
      "$"
  );
  return { method, pattern, paramNames, fn, remap: opts?.remap, fixed: opts?.fixed };
}

const ROUTES: RouteDef[] = [
  // Auth
  compile("POST", "/auth/login", "loginUser"),
  compile("POST", "/auth/change-password", "changePassword"),
  compile("GET", "/auth/me", "getMe"),

  // Dashboard
  compile("GET", "/dashboard/kpis", "getDashboardData", { fixed: { metric: "kpis" } }),
  compile("GET", "/dashboard/overdue-breakdown", "getDashboardData", { fixed: { metric: "overdueBreakdown" } }),
  compile("GET", "/dashboard/contractor-comparison", "getDashboardData", { fixed: { metric: "contractorComparison" } }),

  // Lubrication Points
  compile("GET", "/lubrication-points", "getLubricationPoints"),
  compile("GET", "/lubrication-points/:id", "getLubricationPointById"),
  compile("PATCH", "/lubrication-points/:id", "updateLubricationPoint"),

  // Lubrication Records
  compile("POST", "/lubrication-records", "submitLubrication"),
  compile("GET", "/lubrication-records/pending", "getPendingApprovals"),
  compile("PATCH", "/lubrication-records/:id/approve", "approveLubrication"),
  compile("PATCH", "/lubrication-records/:id/reject", "rejectLubrication"),

  // Action Plans
  compile("GET", "/action-plans", "getActionPlans"),
  compile("POST", "/action-plans", "createActionPlan"),
  compile("PATCH", "/action-plans/:id/close", "closeActionPlan"),
  compile("PATCH", "/action-plans/:id/status", "updateActionPlanStatus"),

  // Notifications
  compile("GET", "/notifications", "getNotifications"),
  compile("PATCH", "/notifications/mark-all-read", "markAllNotificationsRead"),
  compile("PATCH", "/notifications/:id/read", "markNotificationRead"),
  compile("PATCH", "/notifications/:id/archive", "archiveNotification"),

  // Timeline
  compile("GET", "/timeline", "getTimeline"),

  // Settings
  compile("GET", "/settings", "getSettings"),
  compile("PATCH", "/settings/notification-routing/:ruleId", "updateNotificationRouting"),
  compile("PATCH", "/settings/permission-templates/:id", "updatePermissionTemplate"),
  compile("GET", "/settings/notification-routing", "getNotificationRouting"),
  compile("GET", "/settings/permission-templates", "getPermissionTemplates"),
  compile("PATCH", "/settings/:key", "updateSetting"),

  // Reports
  compile("GET", "/reports/:key", "getReportsData", { remap: { key: "report" } }),

  // Lookups
  compile("GET", "/lookups/organizations", "getLookups", { fixed: { type: "organizations" } }),
  compile("GET", "/lookups/areas", "getLookups", { fixed: { type: "areas" } }),
  compile("GET", "/lookups/equipment", "getLookups", { fixed: { type: "equipment" } }),
  compile("GET", "/lookups/lubricant-types", "getLookups", { fixed: { type: "lubricant-types" } }),
  compile("GET", "/lookups/technicians", "getLookups", { fixed: { type: "technicians" } }),

  // Users
  compile("GET", "/users/titles", "getTitles"),
  compile("GET", "/users", "getUsers"),
  compile("POST", "/users", "createUser"),
  compile("PATCH", "/users/:id/active", "updateUserActive"),

  // Audit Log
  compile("GET", "/audit-log", "getAuditLog"),

  // Oil Management Center
  compile("GET", "/oil-management/consumption", "getOilConsumption"),
  compile("GET", "/oil-management/forecast", "getOilForecast"),
  compile("GET", "/oil-management/purchase-log", "getPurchaseLog"),
  compile("POST", "/oil-management/purchase-log", "createPurchaseLog"),

  // Oil Sample Center (extract-pdf is intentionally NOT ported — requires
  // server-side OCR not available in Apps Script; mapped to a clear error
  // instead of an opaque "no route" failure. See MIGRATION_CHECKLIST.md)
  compile("POST", "/oil-samples/extract-pdf", "__UNSUPPORTED_PDF_EXTRACTION__"),
  compile("GET", "/oil-samples/trend/:lpId", "getOilSampleTrend"),
  compile("GET", "/oil-samples/:id", "getOilSampleById"),
  compile("GET", "/oil-samples", "getOilSamples"),
  compile("POST", "/oil-samples", "createOilSample"),

  // Route Center
  compile("GET", "/routes/dynamic-preview", "getDynamicRoutePreview"),
  compile("GET", "/routes/my-assignments", "getMyAssignments"),
  compile("GET", "/routes", "getRoutes"),
  compile("POST", "/routes/:id/assign", "assignRoute", { remap: { id: "routeId" } }),
  compile("POST", "/routes", "createRoute"),
  compile("PATCH", "/routes/assignments/:id/start", "startAssignment"),
  compile("PATCH", "/routes/assignments/:id/points/:lpId/complete", "completeAssignmentPoint"),
  compile("PATCH", "/routes/assignments/:id/points/:lpId/skip", "skipAssignmentPoint"),
];

function resolveRoute(method: RouteDef["method"], path: string): { route: RouteDef; pathParams: Record<string, string> } {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (!match) continue;
    const pathParams: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      const key = route.remap?.[name] || name;
      pathParams[key] = decodeURIComponent(match[i + 1]);
    });
    return { route, pathParams };
  }
  throw new Error(`No Apps Script route mapped for ${method} ${path}. Add it to ROUTES in lib/api.ts.`);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

// Intentional `any` default below: every existing page (untouched by this
// migration) reads res.data.someField with no type narrowing, exactly as
// axios's default AxiosResponse<any> allowed. Narrowing this to `unknown`
// compiles cleanly here but breaks `tsc -b` across ~30 call sites in
// pages/*.tsx that this migration must not touch.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ApiResult<T = any> {
  data: T;
  status: number;
}

class ApiError extends Error {
  response: { status: number; data: { error: string } };
  constructor(message: string, status: number) {
    super(message);
    this.response = { status, data: { error: message } };
  }
}

let onUnauthorized: (() => void) | null = null;
/** Lets the app register a 401 handler (e.g. redirect to /login) without this file importing the router. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

interface AppsScriptEnvelope {
  ok: boolean;
  data?: unknown;
  error?: string;
  status?: number;
}

async function callAppsScript(fn: string, params: Record<string, unknown>, method: "GET" | "POST"): Promise<ApiResult> {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  let res: Response;

  if (method === "GET") {
    const qs = new URLSearchParams({ fn, token, p: JSON.stringify(params) });
    res = await fetch(`${APPS_SCRIPT_URL}?${qs.toString()}`, { method: "GET" });
  } else {
    // Plain string body -> browser sends "text/plain;charset=UTF-8" by
    // default, which is CORS-safelisted and avoids a preflight OPTIONS call
    // that Apps Script Web Apps can't answer.
    res = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify({ fn, token, params }) });
  }

  let body: AppsScriptEnvelope;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("Unexpected response from the server.", res.status || 500);
  }

  if (!body.ok) {
    const status = body.status || 500;
    if (status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(body.error || "Something went wrong", status);
  }
  return { data: body.data, status: 200 };
}

interface RequestConfig {
  params?: Record<string, unknown>;
  /** Accepted for call-site compatibility with ReportsPage.tsx's CSV export
   * button (an axios-style option). Only "blob" is special-cased: CSV export
   * isn't implemented on this backend (getReportsData returns JSON only —
   * see MIGRATION_CHECKLIST.md), so a blob request fails clearly up front
   * instead of crashing later at `URL.createObjectURL(res.data)` with a
   * plain object instead of a real Blob. */
  responseType?: "json" | "blob" | "text" | "arraybuffer";
}

type RequestBody = Record<string, unknown>;

function dispatch(method: RouteDef["method"], url: string, bodyOrConfig?: unknown): Promise<ApiResult> {
  const { route, pathParams } = resolveRoute(method, url.split("?")[0]);

  if (route.fn === "__UNSUPPORTED_PDF_EXTRACTION__") {
    return Promise.reject(new ApiError("PDF extraction isn't available in this version — enter oil sample results manually instead.", 501));
  }
  if ((method === "GET" || method === "DELETE") && (bodyOrConfig as RequestConfig | undefined)?.responseType === "blob") {
    return Promise.reject(new ApiError("CSV export isn't available in this version — use the on-screen report instead.", 501));
  }

  const httpMethod: "GET" | "POST" = method === "GET" ? "GET" : "POST";

  const extra: Record<string, unknown> =
    method === "GET" || method === "DELETE"
      ? (bodyOrConfig as RequestConfig | undefined)?.params || {}
      : (bodyOrConfig as RequestBody | undefined) || {};

  const params = { ...extra, ...pathParams, ...(route.fixed || {}) };
  return callAppsScript(route.fn, params, httpMethod);
}

export const api = {
  get: (url: string, config?: RequestConfig) => dispatch("GET", url, config),
  // The trailing rest param exists only so TypeScript accepts the one
  // existing call site that passes a 3rd (axios-style headers) argument —
  // see OilSampleCenterPage.tsx's PDF-extraction upload, which this client
  // intentionally rejects before that argument would ever be read.
  post: (url: string, body?: unknown, ..._rest: unknown[]) => { void _rest; return dispatch("POST", url, body); },
  patch: (url: string, body?: unknown, ..._rest: unknown[]) => { void _rest; return dispatch("PATCH", url, body); },
  delete: (url: string, config?: RequestConfig) => dispatch("DELETE", url, config),
};

export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) return err.response.data.error || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
