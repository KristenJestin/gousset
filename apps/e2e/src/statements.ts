import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { exampleStatement, writeStatement } from "@gousset/fixture";
import type { StatementFormat } from "@gousset/fixture";

/** Each format's file of the made-up example statement, by format, ready for `setInputFiles`. */
export type StatementPaths = { [format in StatementFormat]: string };

/** Writes the example statement in every format into `folder`. */
export async function writeStatements(folder: string): Promise<StatementPaths> {
  await mkdir(folder, { recursive: true });

  const write = async (format: StatementFormat) => {
    const file = writeStatement(format, exampleStatement);
    const path = join(folder, file.fileName);

    await writeFile(path, file.contents, "utf8");

    return path;
  };

  return {
    ofx: await write("ofx"),
    qif: await write("qif"),
    camt053: await write("camt053"),
    mt940: await write("mt940"),
    csv: await write("csv"),
  };
}
