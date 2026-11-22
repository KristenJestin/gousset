import { readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The lint scenario writes its pages where the app's pages live, so they get the app's own lint
// and TypeScript configuration. They are ignored by Git (.gitignore) and removed after each
// lint; a run killed in between leaves one, which the next run's global setup removes.

/** apps/web/src, where a probe page is written. */
export const PROBE_FOLDER = fileURLToPath(new URL("../../../apps/web/src/", import.meta.url));

const PREFIX = "lint-probe-";

/** A new probe page's path. */
export function probePath(): string {
  return `${PROBE_FOLDER}${PREFIX}${process.pid}-${Date.now()}.tsx`;
}

/** Removes every probe page a killed run may have left. */
export function removeProbes(): void {
  for (const name of readdirSync(PROBE_FOLDER)) {
    if (name.startsWith(PREFIX) && name.endsWith(".tsx")) {
      rmSync(`${PROBE_FOLDER}${name}`, { force: true });
    }
  }
}
