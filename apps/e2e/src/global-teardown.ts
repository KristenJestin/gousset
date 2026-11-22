import { dropDatabase, templateDatabase } from "./database";

/** The workers dropped their own databases; the template goes last. */
export default async function globalTeardown(): Promise<void> {
  await dropDatabase(templateDatabase());
}
