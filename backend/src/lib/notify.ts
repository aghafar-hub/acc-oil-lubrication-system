import { prisma } from "./prisma";

/**
 * Routing rules store semantic tokens (not literal title names) so one rule
 * works across both contractor orgs. This resolves a token list + an event's
 * organization context into concrete user ids to notify.
 *
 *   OWN_ORG_TECHNICIAN / OWN_ORG_ENGINEER / OWN_ORG_MANAGER — within `organizationId`
 *   ACC_ENGINEER / ACC_MANAGER / SUPER_ADMIN                — global, regardless of `organizationId`
 *   UPLOADER                                                — the specific user passed as `extraUserIds`
 */
async function resolveRecipients(tokens: string[], organizationId: string | null, extraUserIds: string[] = []) {
  const userIds = new Set<string>(extraUserIds);

  const titleNameFragmentsByToken: Record<string, string | null> = {
    OWN_ORG_TECHNICIAN: "Technician",
    OWN_ORG_ENGINEER: "Engineer",
    OWN_ORG_MANAGER: "Manager",
  };

  for (const token of tokens) {
    if (token === "UPLOADER" || token === "SELF") continue; // handled via extraUserIds
    if (token === "SUPER_ADMIN") {
      const users = await prisma.user.findMany({ where: { title: { name: "Super Admin" } } });
      users.forEach((u) => userIds.add(u.id));
      continue;
    }
    if (token === "ACC_ENGINEER" || token === "ACC_MANAGER") {
      const titleName = token === "ACC_ENGINEER" ? "ACC Engineer" : "ACC Manager";
      const users = await prisma.user.findMany({ where: { title: { name: titleName } } });
      users.forEach((u) => userIds.add(u.id));
      continue;
    }
    const fragment = titleNameFragmentsByToken[token];
    if (fragment && organizationId) {
      const users = await prisma.user.findMany({
        where: { organizationId, title: { name: { contains: fragment } } },
      });
      users.forEach((u) => userIds.add(u.id));
    }
  }
  return Array.from(userIds);
}

interface NotifyOptions {
  typeName: string;
  organizationId: string | null;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  extraUserIds?: string[]; // e.g. the uploader for PDF_EXTRACTION_FAILURE
}

export async function notify(opts: NotifyOptions) {
  const type = await prisma.notificationType.findUnique({
    where: { name: opts.typeName },
    include: { routingRules: true },
  });
  if (!type) {
    console.warn(`notify(): unknown notification type "${opts.typeName}"`);
    return;
  }
  const rule = type.routingRules[0];
  const tokens: string[] = rule ? JSON.parse(rule.recipientTitleNames as unknown as string) : [];
  const recipients = await resolveRecipients(tokens, opts.organizationId, opts.extraUserIds ?? []);

  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      typeId: type.id,
      message: opts.message,
      relatedEntityType: opts.relatedEntityType,
      relatedEntityId: opts.relatedEntityId,
      priority: type.defaultPriority,
    })),
  });
}
