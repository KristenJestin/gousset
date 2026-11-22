import { readFile } from "node:fs/promises";

import { exampleStatement } from "@gousset/fixture";

import { expect, test } from "../src/test";

const read = (path: string) => readFile(path, "utf8");

test("the made-up statements are written in every format", async ({ page, statements }) => {
  const { iban } = exampleStatement.account;

  const ofx = await read(statements.ofx);

  expect(ofx).toContain("<TRNAMT>-4.20</TRNAMT>");
  expect(ofx).toContain("<MEMO>CB MARCHE DE LA PLACE &amp; CIE 08/10</MEMO>");
  expect(ofx).toContain("<BALAMT>2790.00</BALAMT>");

  const qif = await read(statements.qif);

  expect(qif).toMatch(/^!Type:Bank\n/);
  expect(qif).toContain("D03/10/2026\nT-4.20\nPCB LE FOURNIL DES TILLEULS 02/10\n");

  const camt = await read(statements.camt053);

  expect(camt).toContain(`<IBAN>${iban}</IBAN>`);
  expect(camt).toContain('<Amt Ccy="EUR">4.20</Amt>\n<CdtDbtInd>DBIT</CdtDbtInd>');
  expect(camt).toContain('<Cd>CLBD</Cd></CdOrPrtry></Tp>\n<Amt Ccy="EUR">2790.00</Amt>');

  const mt940 = await read(statements.mt940);

  expect(mt940).toContain(`:25:${iban}\r\n`);
  expect(mt940).toContain(":61:2610031003D4,20NTRFEX2026100301//EX2026100301\r\n");
  expect(mt940).toContain(":62F:C261031EUR2790,00\r\n");

  const csv = await read(statements.csv);

  expect(csv).toContain('03/10/2026;"CB LE FOURNIL DES TILLEULS 02/10";-4,20;EUR;EX2026100301\n');

  // The XML formats parse in a real browser, as a file picked on the import screen would be.
  for (const xml of [ofx, camt]) {
    const errors = await page.evaluate(
      (text) =>
        new DOMParser().parseFromString(text, "application/xml").getElementsByTagName("parsererror")
          .length,
      xml,
    );

    expect(errors).toBe(0);
  }
});
