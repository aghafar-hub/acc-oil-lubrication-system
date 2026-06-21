import { Request, Response, NextFunction } from "express";

/** Blocks the request unless the caller's permission template grants this screen. */
export function requireScreen(screenKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.screenAccess[screenKey]) {
      return res.status(403).json({ error: `No access to screen: ${screenKey}` });
    }
    next();
  };
}

/** Blocks the request unless the caller's permission template grants this capability. */
export function requireCapability(capabilityKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!req.user.capabilities[capabilityKey]) {
      return res.status(403).json({ error: `Missing capability: ${capabilityKey}` });
    }
    next();
  };
}

/**
 * Org-scoping helper for Prisma `where` clauses on models that carry an
 * organizationId field directly (User, Title, Route, OilPurchaseLog).
 * ALL_ORGS-scoped callers (ACC, Super Admin) get no filter; OWN_ORG-scoped
 * callers (RHI/ASEC) are restricted to their own organization.
 */
export function directOrgScopeFilter(user: { dataScope: string; organizationId: string | null }) {
  if (user.dataScope === "ALL_ORGS") return {};
  return { organizationId: user.organizationId ?? "__none__" };
}
