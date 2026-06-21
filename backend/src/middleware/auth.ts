import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { AuthUser } from "../types/express";

interface TokenPayload {
  userId: string;
  isMobile?: boolean;
}

export function signToken(userId: string, isMobile = false): string {
  const secret = process.env.JWT_SECRET as string;
  const expiresIn = isMobile
    ? process.env.JWT_MOBILE_EXPIRES_IN || "30d"
    : process.env.JWT_EXPIRES_IN || "8h";
  return jwt.sign({ userId, isMobile } as TokenPayload, secret, { expiresIn } as jwt.SignOptions);
}

/**
 * Verifies the bearer token and attaches a fresh AuthUser (re-fetched from
 * the DB, not just decoded from the token) to req.user. Re-fetching on every
 * request means a Super Admin permission-template edit takes effect for a
 * user's NEXT request, not only after they log out and back in.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or malformed Authorization header" });
    }
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as TokenPayload;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { title: { include: { permissionTemplate: true } }, organization: true },
    });
    if (!user || !user.active) {
      return res.status(401).json({ error: "Account not found or deactivated" });
    }

    const template = user.title?.permissionTemplate;
    const authUser: AuthUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      titleId: user.titleId,
      titleName: user.title?.name ?? null,
      organizationId: user.organizationId,
      organizationName: user.organization?.name ?? null,
      dataScope: (template?.dataScope as "OWN_ORG" | "ALL_ORGS") ?? "OWN_ORG",
      screenAccess: template ? JSON.parse(template.screenAccess as unknown as string) : {},
      capabilities: template ? JSON.parse(template.capabilities as unknown as string) : {},
      languagePref: user.languagePref,
    };
    req.user = authUser;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
