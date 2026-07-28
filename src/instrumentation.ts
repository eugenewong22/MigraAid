import * as Sentry from "@sentry/nextjs";
import { getEnv } from "./env";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail once per cold start, before any handler runs, rather than letting a
    // missing variable surface as a silent degradation in whichever request
    // happens to touch it first.
    getEnv();
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
