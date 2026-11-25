import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { merchantKey } from "@gousset/core";
import {
  account,
  category,
  entry,
  entryPart,
  merchant,
  merchantAlias,
  statementImport,
  statementLine,
} from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, eq, isNull } from "drizzle-orm";

import { onPhone } from "./frame";
import type { openUserData } from "./user-data";

/** A block of the monthly review, by its title. */
export const block = (page: Page, title: string) => page.getByRole("region", { name: title });

/**
 * The month switcher beside the review's title. The recurring payments' calendar has one of its
 * own in today's month, named apart ("Recurring payments month"): one group alone is "Month".
 */
export const monthSwitcher = (page: Page) =>
  page.getByRole("group", { name: "Month", exact: true });

/**
 * A key of the month bar's legend, by its role (spent, saved, left): its amount and its name. The
 * bar's drawn parts carry the same `data-role`, and hold no text.
 */
export const monthBarKey = (page: Page, role: "spent" | "saved" | "left") =>
  block(page, "The month")
    .getByRole("group", { name: "What came in, by part" })
    .locator(`[data-role="${role}"]`);

/**
 * A secondary block's content: in its block on a wide screen; on a phone the block is one line,
 * which opens it in a sheet. `closeBlock` closes it.
 */
export async function openBlock(page: Page, title: string): Promise<Locator> {
  if (!onPhone(page)) {
    return block(page, title);
  }

  await block(page, title)
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .click();

  const sheet = page.getByRole("dialog", { name: title });

  await expect(sheet).toBeVisible();

  return sheet;
}

/** Closes what `openBlock` opened: the sheet on a phone; nothing on a wide screen. */
export async function closeBlock(page: Page): Promise<void> {
  if (!onPhone(page)) {
    return;
  }

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** A top-level category of the user's, of the defaults they were given. */
async function categoryNamed(
  transaction: UserTransaction,
  kind: "expense" | "income",
  name: string,
) {
  const [found] = await transaction
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.kind, kind), eq(category.name, name), isNull(category.parentId)));

  if (found === undefined) {
    throw new Error(`No ${kind} category named ${name}.`);
  }

  return found.id;
}

/**
 * September and October 2026 of a user's, as the app writes them: each line counted with its
 * entry, the transfer's two sides with none. A salary each month; groceries at a market (€120 in
 * September, €80 in October); a game paid through an intermediary, Payflow, in Leisure, whose
 * benchmark the user set at €40 (€60); a payment still in "Other", waiting to be reviewed (€15);
 * €500 moved to savings; and $25 spent on a dollar account. The lines are written by hand; the
 * everyday account had September's statement imported, so that it expects October's, which the two
 * others, kept by hand and never imported, do not (#235). Every name and amount is invented.
 */
export function seedReviewMonths(data: ReturnType<typeof openUserData>, owner: string) {
  return data.asUser(owner, async (transaction) => {
    const [everyday, savings, dollars] = await transaction
      .insert(account)
      .values([
        { userId: owner, name: "Everyday account", kind: "current", currency: "EUR" },
        { userId: owner, name: "Rainy-day savings", kind: "savings", currency: "EUR" },
        { userId: owner, name: "Travel card", kind: "current", currency: "USD" },
      ])
      .returning({ id: account.id });

    if (everyday === undefined || savings === undefined || dollars === undefined) {
      throw new Error("The accounts were not made.");
    }

    await transaction.insert(statementImport).values({
      userId: owner,
      accountId: everyday.id,
      fileName: "everyday-september.ofx",
      fileSha256: "e2e-review-everyday-september-sha256",
      format: "ofx",
      status: "done",
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
    });

    const groceries = await categoryNamed(transaction, "expense", "Groceries");
    const leisure = await categoryNamed(transaction, "expense", "Leisure");
    const other = await categoryNamed(transaction, "expense", "Other");
    const salary = await categoryNamed(transaction, "income", "Salary");

    await transaction
      .update(category)
      .set({ benchmarkMode: "fixed", benchmarkMinor: 4000 })
      .where(eq(category.id, leisure));

    const merchants = await transaction
      .insert(merchant)
      .values([
        { userId: owner, name: "Greenmarket" },
        { userId: owner, name: "Payflow", isIntermediary: true },
      ])
      .returning({ id: merchant.id, name: merchant.name });

    for (const each of merchants) {
      const label = each.name.toUpperCase();

      await transaction.insert(merchantAlias).values({
        userId: owner,
        merchantId: each.id,
        alias: merchantKey(label, null) ?? label,
      });
    }

    const payflow = merchants.find((each) => each.name === "Payflow")?.id ?? null;

    const line = async (
      accountId: string,
      bookedOn: string,
      amountMinor: number,
      label: string,
    ) => {
      const [made] = await transaction
        .insert(statementLine)
        .values({ userId: owner, accountId, source: "manual", bookedOn, amountMinor, label })
        .returning({ id: statementLine.id });

      if (made === undefined) {
        throw new Error("The line was not made.");
      }

      return made.id;
    };

    /** A line and its one entry; classified by the user unless said otherwise. */
    const classified = async (
      entryOf: {
        kind: "expense" | "income";
        categoryId: string;
        merchantId?: string | null;
        classifiedBy?: "default" | "user";
      },
      bookedOn: string,
      amountMinor: number,
      label: string,
      accountId = everyday.id,
    ) => {
      const lineId = await line(accountId, bookedOn, amountMinor, label);

      const [made] = await transaction
        .insert(entry)
        .values({
          userId: owner,
          kind: entryOf.kind,
          happenedOn: bookedOn,
          categoryId: entryOf.categoryId,
          merchantId: entryOf.merchantId ?? null,
          classifiedBy: entryOf.classifiedBy ?? "user",
        })
        .returning({ id: entry.id });

      if (made === undefined) {
        throw new Error("The entry was not made.");
      }

      await transaction.insert(entryPart).values({
        userId: owner,
        entryId: made.id,
        lineId,
        role: "payment",
        amountMinor: Math.abs(amountMinor),
      });
    };

    const income = { kind: "income", categoryId: salary } as const;

    // September: the month before, €120 spent.
    await classified(income, "2026-09-01", 200_000, "ACME PAYROLL");
    await classified(
      { kind: "expense", categoryId: groceries },
      "2026-09-10",
      -12_000,
      "GREENMARKET",
    );

    // October: €155 spent, €500 set aside, $25 spent on the dollar account.
    await classified(income, "2026-10-01", 200_000, "ACME PAYROLL");
    await classified(
      { kind: "expense", categoryId: groceries },
      "2026-10-12",
      -8000,
      "GREENMARKET",
    );
    await classified(
      { kind: "expense", categoryId: leisure, merchantId: payflow },
      "2026-10-14",
      -6000,
      "PAYFLOW",
    );
    await classified(
      { kind: "expense", categoryId: other, classifiedBy: "default" },
      "2026-10-18",
      -1500,
      "CARD 4417 KIOSK",
    );
    await classified(
      { kind: "expense", categoryId: groceries },
      "2026-10-20",
      -2500,
      "CORNER DELI",
      dollars.id,
    );

    await transaction.insert(transfer).values({
      userId: owner,
      outLineId: await line(everyday.id, "2026-10-05", -50_000, "TO SAVINGS"),
      inLineId: await line(savings.id, "2026-10-05", 50_000, "FROM EVERYDAY"),
      pairedBy: "user",
    });
  });
}
