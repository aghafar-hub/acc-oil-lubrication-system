export interface AuthUser {
  id: string;
  name: string;
  email: string;
  titleId: string | null;
  titleName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  dataScope: "OWN_ORG" | "ALL_ORGS";
  screenAccess: Record<string, boolean>;
  capabilities: Record<string, boolean>;
  languagePref: string;
}

export type StatusBucket =
  | "OVERDUE"
  | "DUE_TODAY"
  | "DUE_THIS_WEEK"
  | "DUE_THIS_MONTH"
  | "OK"
  | "NO_HISTORY"
  | "CONDITION_MONITORING";

export interface DashboardKpis {
  totalLubricationPoints: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  dueThisMonth: number;
  ok: number;
  noHistory: number;
  compliancePct: number;
  conditionMonitoringPoints: number;
  oilSamplesOverdue: number;
  oilSamplesDueThisMonth: number;
  pendingApproval: number;
  completedThisMonth: number;
  openActionPlans: number;
  overdueActionPlans: number;
}

export interface ExplorerRow {
  id: string;
  lpIdCode: string;
  equipmentIdCode: string;
  assetName: string;
  pointDescription: string;
  areaName: string | null;
  contractor: string | null;
  lubricantType: string | null;
  standardQuantityL: number | null;
  frequencyLabel: string | null;
  frequencyType: string;
  lastChangeDate: string | null;
  nextDue: string | null;
  status: StatusBucket;
  oaStatus: StatusBucket | null;
}
