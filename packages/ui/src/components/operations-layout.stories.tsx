import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { ACCOUNTS, madeUpOperations } from "../stories/made-up";
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

/** The screen as the page composes it: filters, count, list and the open line's detail. */
function Screen({ start }: { start?: string }) {
  const [values, setValues] = useState(NO_OPERATIONS_FILTERS);
  const [openId, setOpenId] = useState<string | undefined>(start);
  const rows = matching(values);
  const open = ROWS.find((row) => row.id === openId);

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
            id={open.id}
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
 * in a block filling the screen's height with its own scroller, and the open line's detail in a
 * 340 px column at its right; on a narrower screen the detail covers the list, which keeps its
 * scroll under it. The page composes it, and writes no layout class of its own.
 *
 * Loading: `OperationsListSkeleton` in `list`, `LineDetailSkeleton` in `detail`, no `count`.
 *
 * Motion: filtering, the rows that stay slide and the others fade (200 ms); opening a line, the
 * detail grows out of its row and folds back on close (300 ms, ease-out); cut under reduced
 * motion.
 *
 * Don't: put the list in a block of the page's own, or render the detail without its key (the
 * line's id): a new line's detail must grow from its own row.
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
        detail={<LineDetailSkeleton />}
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

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => (
    <div className="p-4">
      <Screen start="line-3" />
    </div>
  ),
};
