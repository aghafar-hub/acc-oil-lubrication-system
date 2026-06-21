import { checkOverdueAndCreateActions } from "./checkOverdue";
import { prisma } from "../lib/prisma";

checkOverdueAndCreateActions()
  .then((result) => {
    console.log(`Overdue check complete: scanned ${result.pointsScanned} points, created ${result.actionsCreated} action plan(s).`);
  })
  .catch((err) => {
    console.error("Overdue check failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
