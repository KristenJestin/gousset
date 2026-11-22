import { prepareTemplate, startRun } from "./database";

/**
 * Once per run, before any worker: the run's id, then the template every worker's database is
 * cloned from.
 */
export default async function globalSetup(): Promise<void> {
  startRun();
  await prepareTemplate();
}
