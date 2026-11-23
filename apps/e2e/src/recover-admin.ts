import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { harness } from "./config";
import { databaseUrl } from "./database";

/** The image's `recover-admin` command, as `pnpm build` bundles it (packages/auth). */
const BUILT_COMMAND = fileURLToPath(
  new URL("../../../packages/auth/dist/recover-admin.mjs", import.meta.url),
);

/** How a command ended: its exit code (`null` when a signal ended it) and what it wrote. */
export type CommandRun = { code: number | null; stdout: string; stderr: string };

/**
 * Runs `recover-admin <email>` against a worker's database, as whoever runs an installation does
 * on the server (docs/releases.md, "Recovering the administrator"): the built command, or the image
 * named by `E2E_APP_IMAGE` through its entry point. It is given the owner's URL, as the image is,
 * through the environment, never the command line, where any local user could read its password.
 */
export async function recoverAdministrator(database: string, email: string): Promise<CommandRun> {
  if (harness.appImage === undefined && !existsSync(BUILT_COMMAND)) {
    throw new Error(
      "packages/auth is not built: run `pnpm build` first (the harness runs its recover-admin).",
    );
  }

  const [program, args] =
    harness.appImage === undefined
      ? [process.execPath, [BUILT_COMMAND, email]]
      : [
          "docker",
          [
            "run",
            "--rm",
            "--network",
            "host",
            "--env",
            "DATABASE_URL",
            harness.appImage,
            "recover-admin",
            email,
          ],
        ];

  const command = spawn(program, args, {
    env: { ...process.env, DATABASE_URL: databaseUrl(database) },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });

  let stdout = "";
  let stderr = "";

  command.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  command.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    command.once("error", reject);
    command.once("close", resolve);
  });

  return { code, stdout, stderr };
}

/** The temporary password a successful run printed, on a line of its own, indented. */
export function temporaryPasswordIn(stdout: string): string {
  const printed = /^ {2}(\S+)$/m.exec(stdout)?.[1];

  if (printed === undefined) {
    throw new Error("recover-admin printed no temporary password.");
  }

  return printed;
}
