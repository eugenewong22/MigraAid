/**
 * Deploy-time configuration gate.
 *
 * Runs before the build, so a production deployment missing a load-bearing
 * variable fails the *deploy* rather than shipping and degrading silently in
 * front of workers. Mirrors the posture `migrate.ts` already takes for schema
 * drift: catch it while there is still a previous deployment serving traffic.
 *
 * Run with: pnpm check:env   (also wired into `vercel-build`)
 */
import "../env";
import { checkEnv, formatEnvProblems, isProductionDeployment } from "@/env";

function main() {
  const target = isProductionDeployment()
    ? "production"
    : (process.env.VERCEL_ENV ?? "local");
  const result = checkEnv();

  if (!result.ok) {
    console.error(`Environment check failed for ${target}:\n`);
    console.error(formatEnvProblems(result.problems));
    console.error(
      "\nSet these in the Vercel project settings (Production scope), then redeploy.",
    );
    process.exit(1);
  }

  console.log(`Environment check passed for ${target}.`);
  if (!isProductionDeployment()) {
    console.log(
      "Note: production-only requirements were not enforced for this target.",
    );
  }
}

main();
