import "express";

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

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
