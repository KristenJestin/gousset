import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { ACCOUNTS, madeUpOperations } from "../stories/made-up";
import { Button } from "./button";
import { LineDetail, LineDetailSkeleton } from "./line-detail";
import { NO_OPERATIONS_FILTERS } from "../lib/operations";
import type { OperationsFilterValues } from "../lib/operations";
import { ClearFilters, OperationsFilters } from "./operations-filters";
import { OperationsLayout } from "./operations-layout";
import { OperationsList, OperationsListSkeleton } from "./operations-list";
import type { OperationRow } from "./operations-list";

const ROWS: ReadonlyArray<OperationRow> = madeUpOperations(400);

const ACCOUNT_CHOICES = ACCOUNTS.map((account) => ({ value: account.id, label: account.name }));

const accountName = (id: string | null) => ACCOUNTS.find((account) => account.id === id)?.name;

/** What the page's query would answer, done here in the browser for the story. */
function matching(values: OperationsFilterValues) {
  const words = values.search.trim().toUpperCase();
  const account = accountName(values.accountId);

  return ROWS.filter(
    (row) =>
      row.label.includes(words) &&
      (account === undefined || row.account === account) &&
      (!values.toReview || row.toReview === true),
  );
}

/**
 * The screen as the page composes it: filters, count, list and the open line's detail; `stepping`,
 * the detail opens the next line from its top, as the review does once a line is reviewed.
 */
function Screen({ start, stepping = false }: { start?: string; stepping?: boolean }) {
  const [values, setValues] = useState(NO_OPERATIONS_FILTERS);
  const [openId, setOpenId] = useState<string | undefined>(start);
  const rows = matching(values);
  const index = ROWS.findIndex((row) => row.id === openId);
  const open = ROWS[index];
  const next = ROWS[index + 1];

  return (
    <OperationsLayout
      filters={
        <OperationsFilters
          values={values}
          onChange={setValues}
          accounts={ACCOUNT_CHOICES}
          count={rows.length}
        />
      }
      count={rows.length}
      countAction={<ClearFilters values={values} onChange={setValues} />}
      list={
        <OperationsList
          rows={rows}
          total={rows.length}
          openId={openId}
          onOpen={(id) => setOpenId(id === openId ? undefined : id)}
          label="Operations"
        />
      }
      detail={
        open === undefined ? undefined : (
          <LineDetail
            key={open.id}
            review={
              stepping && next !== undefined ? (
                <Button variant="secondary" onClick={() => setOpenId(next.id)}>
                  Next line
                </Button>
              ) : undefined
            }
            label={open.label}
            amount={open.amount}
            account={open.account}
            bookedOn={`${open.day} 2026`}
            rawLabel={`${open.label} CARTE 4971`}
            looksLike={open.toReview === true ? "21 Oct., CB GREENMARKET, −€52.00" : undefined}
            importedFrom={{
              fileName: "current-account-2026-10.csv",
              importedOn: "24 Oct. 2026",
              period: "1–23 Oct. 2026",
            }}
            onClose={() => setOpenId(undefined)}
          />
        )
      }
    />
  );
}

/**
 * The operations screen's places (screen 2): the filters, the count of lines that match (with
 * "Clear filters" at the end of its line, once one is set), the list
 * in a block filling the screen's height with its own scroller, and the open line's detail in the
 * shared side sheet over the list, on every screen (#182): from the right edge from Tailwind's
 * `md` on, from the bottom on a phone. The list keeps its width and its scroll under it. One sheet
 * holds the lines opened one after the other, and stays open from one to the next. The page
 * composes it, and writes no layout class of its own.
 *
 * Loading: `OperationsListSkeleton` in `list`, `LineDetailSkeleton` in `detail`, no `count`.
 *
 * Motion: filtering, the rows that stay slide and the others fade (200 ms). Opening a line, the
 * sheet slides in from its edge in 300 ms (ease-out) and back out in 200 ms (ease-in), its
 * backdrop fading in and out; from one line to the next it stays still. Cut under reduced motion.
 *
 * Don't: put the list in a block of the page's own, open the detail beside the list, or render the
 * detail without its key (the line's id): each line's content is its own.
 */
const meta = {
  title: "Operations/OperationsLayout",
  component: OperationsLayout,
  parameters: { layout: "fullscreen" },
  args: { filters: null, list: null },
  render: () => (
    <div className="p-4 md:p-8">
      <Screen />
    </div>
  ),
} satisfies Meta<typeof OperationsLayout>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Filter, open a line, close it. */
export const Desktop: Story = {};

/** A line already open, as from the page's address. */
export const LineOpen: Story = {
  render: () => (
    <div className="p-4 md:p-8">
      <Screen start="line-3" />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="p-4 md:p-8">
      <OperationsLayout
        filters={
          <OperationsFilters
            values={NO_OPERATIONS_FILTERS}
            onChange={() => undefined}
            accounts={ACCOUNT_CHOICES}
          />
        }
        list={<OperationsListSkeleton />}
        detail={<LineDetailSkeleton onClose={() => undefined} />}
      />
    </div>
  ),
};

export const French: Story = {
  render: () => (
    <InFrench>
      <div className="p-4 md:p-8">
        <Screen />
      </div>
    </InFrench>
  ),
};

/** A line open, in French: its words fit the sheet. */
export const LineOpenFrench: Story = {
  render: () => (
    <InFrench>
      <div className="p-4 md:p-8">
        <Screen start="line-3" />
      </div>
    </InFrench>
  ),
};

/**
 * From one line to the next (the review's "Next line"): the side sheet stays open and still, the
 * next line's content in the last one's place.
 */
export const NextLine: Story = {
  render: () => (
    <div className="p-4 md:p-8">
      <Screen start="line-3" stepping />
    </div>
  ),
};

/**
 * On a phone, from one line to the next (the review's "Next line"): the sheet stays open and
 * still, the next line's content in the last one's place.
 */
export const PhoneNextLine: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => (
    <div className="p-4">
      <Screen start="line-3" stepping />
    </div>
  ),
};

/** On a phone the open line is a sheet over the list, rising from the bottom edge. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => (
    <div className="p-4">
      <Screen start="line-3" />
    </div>
  ),
};
