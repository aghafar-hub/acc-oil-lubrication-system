import "dotenv/config";
import express from "express";
import cors from "cors";
import { sheetsCache } from './lib/sheetsCache';

import authRoutes from "./routes/auth";
import dashboardRoutes from "./routes/dashboard";
import lubricationPointsRoutes from "./routes/lubricationPoints";
import lubricationRecordsRoutes from "./routes/lubricationRecords";
import lookupsRoutes from "./routes/lookups";
import notificationsRoutes from "./routes/notifications";
import actionPlansRoutes from "./routes/actionPlans";
import usersRoutes from "./routes/users";
import auditLogRoutes from "./routes/auditLog";
import settingsRoutes from "./routes/settings";
import oilSamplesRoutes from "./routes/oilSamples";
import routeCenterRoutes from "./routes/routeCenter";
import oilManagementRoutes from "./routes/oilManagement";
import reportsRoutes from "./routes/reports";
import timelineRoutes from "./routes/timeline";
import { checkOverdueAndCreateActions } from "./jobs/checkOverdue";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "10mb" })); // generous limit for base64 photo uploads from mobile

app.get("/api/health", (req, res) => res.json({ status: "ok", service: "acc-oil-lubrication-api" }));

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/lubrication-points", lubricationPointsRoutes);
app.use("/api/lubrication-records", lubricationRecordsRoutes);
app.use("/api/lookups", lookupsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/action-plans", actionPlansRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/audit-log", auditLogRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/oil-samples", oilSamplesRoutes);
app.use("/api/routes", routeCenterRoutes);
app.use("/api/oil-management", oilManagementRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/timeline", timelineRoutes);

// Centralized error handler — keeps unhandled exceptions from leaking stack traces to clients
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`ACC Oil Lubrication API listening on http://localhost:${port}`);
});

// Auto-creates the "auto" Action Plans (Overdue Lubrication / Oil Sample Overdue) the
// moment a point crosses into OVERDUE — see jobs/checkOverdue.ts. Runs shortly after
// boot (gives Prisma a moment to connect) and then hourly. For production, an external
// cron calling `npm run check-overdue` works just as well and survives restarts better
// than this in-process interval; both call the same idempotent function.
setTimeout(() => {
  checkOverdueAndCreateActions()
    .then((r) => console.log(`Overdue check: scanned ${r.pointsScanned}, created ${r.actionsCreated}`))
    .catch((err) => console.error("Overdue check failed:", err));
}, 5_000);
setInterval(() => {
  checkOverdueAndCreateActions().catch((err) => console.error("Overdue check failed:", err));
}, 60 * 60 * 1000);
