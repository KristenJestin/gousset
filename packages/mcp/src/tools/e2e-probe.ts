import { Effect, Schema } from "effect";

import { defineTool } from "../tool";

/**
 * Set to `on` by the end-to-end harness only (`apps/e2e/src/app-server.ts`), like
 * `GOUSSET_E2E_CLOCK`. An installation never sets it: neither the image, nor docker-compose.yml,
 * nor `.env.schema` names it, and without it this tool is not served.
 */
export const E2E_PROBE_VARIABLE = "GOUSSET_E2E_PROBE";

const ProbeInput = Schema.Struct({ action: Schema.Literal("write") });

/**
 * A write action that changes nothing, served only to the end-to-end harness: v0.1 has no write
 * tool yet, and the door's refusal of a write to a read-only token is proved through the built
 * app with it. Not part of Gousset's tools: never listed in production, nor in the guards.
 */
export const e2eProbeTool = defineTool({
  name: "e2e_probe",
  title: "End-to-end probe",
  description: "Test only: a write action that changes nothing.",
  idempotent: true,
  input: ProbeInput,
  example: { action: "write" },
  access: { write: "write" },
  run: () => Effect.succeed("The write was allowed; nothing was changed."),
});
