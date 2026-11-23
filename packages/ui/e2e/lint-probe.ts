import { readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The lint scenarios write their probes where the app's pages and the shared components live, so
// they get those folders' own lint and TypeScript configuration. They are ignored by Git
// (.gitignore) and removed after each lint; a run killed in between leaves one, which the next
// run's global setup removes.

/** Where a probe is written: among the app's pages (apps/web/src), or the shared components. */
const PROBE_FOLDERS = {
  page: fileURLToPath(new URL("../../../apps/web/src/", import.meta.url)),
  component: fileURLToPath(new URL("../src/components/", import.meta.url)),
};

export type ProbePlace = keyof typeof PROBE_FOLDERS;

/** A probe's file: a page or a component (`.tsx`), or a module without JSX (`.ts`). */
export type ProbeExtension = ".tsx" | ".ts";

const PREFIX = "lint-probe-";

/** A new probe's path. */
export function probePath(place: ProbePlace = "page", extension: ProbeExtension = ".tsx"): string {
  return `${PROBE_FOLDERS[place]}${PREFIX}${process.pid}-${Date.now()}${extension}`;
}

/** Removes every probe a killed run may have left, in each folder. */
export function removeProbes(): void {
  for (const folder of Object.values(PROBE_FOLDERS)) {
    for (const name of readdirSync(folder)) {
      if (name.startsWith(PREFIX)) {
        rmSync(`${folder}${name}`, { force: true });
      }
    }
  }
}
