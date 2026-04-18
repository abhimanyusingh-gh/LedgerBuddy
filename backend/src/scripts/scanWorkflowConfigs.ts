import { connectToDatabase, disconnectFromDatabase } from "@/db/connect.js";
import { scanAllWorkflows } from "@/services/invoice/workflowHealthScanner.js";

async function run() {
  await connectToDatabase();

  const report = await scanAllWorkflows();

  console.log(JSON.stringify(report, null, 2));

  if (report.totalFindings > 0) {
    console.error(`\nFound ${report.totalFindings} issue(s) across ${report.tenantsWithFindings} tenant(s).`);
  } else {
    console.error("\nNo issues found.");
  }

  await disconnectFromDatabase();
  process.exit(report.totalFindings > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Workflow scan failed:", error instanceof Error ? error.message : String(error));
  process.exit(2);
});
