import { exampleStatement } from "@gousset/fixture";
import fc from "fast-check";

import { decodeEntities } from "./text";

// Made-up statements of any size, for the property tests: the fixture's writers write them, the
// readers must read back what they hold.

const dates = fc.date({
  min: new Date("1990-01-01T00:00:00Z"),
  max: new Date("2089-12-31T00:00:00Z"),
  noInvalidDate: true,
});

const days = dates.map((date) => date.toISOString().slice(0, 10));

/** Amounts up to ten billion in either direction: twenty of them still sum to a safe integer. */
const amounts = fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 });

/** Words with what the formats escape or may trip on: `&`, `<`, quotes, accents, `€`. */
const words = fc.stringMatching(/^[A-Z0-9&'"<>./;#ÉÈÀÇéèàç€*-]{1,10}$/);

const labels = fc.array(words, { minLength: 1, maxLength: 6 }).map((chosen) => chosen.join(" "));

const lines = fc.record({
  bookedOn: days,
  amountMinor: amounts,
  label: labels,
  reference: fc.stringMatching(/^[A-Z0-9]{1,16}$/),
});

const parts = fc.record({
  lines: fc.array(lines, { maxLength: 20 }),
  openingBalanceMinor: amounts,
  to: days,
});

/** The example statement's bank and account, with any lines, opening balance and last day. */
export const madeUpStatements = parts.map((made) => ({ ...exampleStatement, ...made }));

/**
 * The made-up statements whose labels hold no entity, for the formats that decode them (OFX,
 * CAMT.053). Their readers decode a label until no entity is left (README, "Entities are decoded
 * until none is left"), so a label written as `&#0;` or `&AMP;` reads back as the entity it looks
 * like, never as written: those labels have tests of their own.
 */
export const madeUpStatementsWithoutEntities = madeUpStatements.filter((statement) =>
  statement.lines.every((line) => decodeEntities(line.label) === line.label),
);
