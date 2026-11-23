import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { madeUpOperations } from "../stories/made-up";
import { Button } from "./button";
import { OperationsList, OperationsListSkeleton } from "./operations-list";
import type { OperationRow } from "./operations-list";

const ROWS: ReadonlyArray<OperationRow> = madeUpOperations(60);

const TEN_THOUSAND: ReadonlyArray<OperationRow> = madeUpOperations(10_000);

const PAGE = 50;

/** The block the page gives the list: a height of its own, so that the list scrolls in itself. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="h-96 overflow-hidden rounded-lg border bg-card">{children}</div>;
}

/** A list whose rows open, as the page keeps the open line. */
function Opening({ rows, total }: { rows: ReadonlyArray<OperationRow>; total?: number }) {
  const [openId, setOpenId] = useState<string | undefined>(undefined);

  return (
    <Frame>
      <OperationsList
        rows={rows}
        total={total ?? rows.length}
        openId={openId}
        onOpen={(id) => setOpenId(id === openId ? undefined : id)}
        label="Operations"
        locale="en"
      />
    </Frame>
  );
}

/** Only the lines to review, or all of them: the rows that stay slide, the others fade. */
function Filtering() {
  const [toReview, setToReview] = useState(false);
  const rows = toReview ? ROWS.filter((row) => row.toReview === true) : ROWS;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="secondary" size="sm" onClick={() => setToReview(!toReview)}>
          {toReview ? "Show every line" : "Only lines to review"}
        </Button>
      </div>
      <Frame>
        <OperationsList
          rows={rows}
          total={rows.length}
          onOpen={() => undefined}
          label="Operations"
        />
      </Frame>
    </div>
  );
}

/** Pages of 50 lines, the next one asked for near the end and loaded after a short wait. */
function Paging() {
  const [loaded, setLoaded] = useState(PAGE);
  const [loading, setLoading] = useState(false);

  return (
    <Frame>
      <OperationsList
        rows={TEN_THOUSAND.slice(0, loaded)}
        total={TEN_THOUSAND.length}
        loadingMore={loading}
        onEnd={() => {
          setLoading(true);
          setTimeout(() => {
            setLoaded((count) => count + PAGE);
            setLoading(false);
          }, 600);
        }}
        onOpen={() => undefined}
        label="Operations"
      />
    </Frame>
  );
}

/**
 * Every statement line, newest first (screen 2, block 2): its day, its raw label with a "To
 * review" chip on a held line, its account (from a tablet's width) and its amount, in tabular
 * figures. A row opens the line, by press, Enter or Space. Virtualised with ui-sdk: only the rows
 * in view are in the page, 48 px each, in a scroller of its own that fills the block the page
 * gives it; `onEnd` asks for the next page and `loadingMore` says it is coming.
 *
 * The server writes the first rows in the flow, without any `style` attribute (the Content
 * Security Policy forbids them); once hydrated, the virtualiser places them where they stood.
 *
 * Loading: `OperationsListSkeleton`, its column titles and rows at the same heights.
 *
 * Motion: when the rows change, the rows that stay slide to their new place, new ones fade in and
 * gone ones fade out (200 ms, ease-out); scrolling moves nothing but the scroll. Opening a line,
 * its `LineDetail` grows out of the row (`operationLayoutId`). Cut under reduced motion.
 *
 * Don't: give it every line at once from the server (page it with `onEnd`), set its height on the
 * list itself (its parent's), or animate the rows a scroll brings.
 */
const meta = {
  title: "Operations/OperationsList",
  component: OperationsList,
  args: { rows: ROWS, total: ROWS.length, onOpen: () => undefined, label: "Operations" },
  render: (args) => (
    <Frame>
      <OperationsList {...args} />
    </Frame>
  ),
} satisfies Meta<typeof OperationsList>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Sixty lines; a row opens on press and is marked while open. */
export const Default: Story = { render: () => <Opening rows={ROWS} /> };

/** Ten thousand generated lines: a few dozen rows in the page at any time. */
export const TenThousandRows: Story = { render: () => <Opening rows={TEN_THOUSAND} /> };

/** A line open: its row is marked and kept in the page wherever the list is scrolled. */
export const LineOpen: Story = { args: { openId: "line-3" } };

/** Toggling the lines to review: the rows that stay slide, the others fade out or in. */
export const ChangingRows: Story = { render: () => <Filtering /> };

/** The next page loads near the end, said by a line under the rows. */
export const LoadingMore: Story = { render: () => <Paging /> };

/** The line under the rows while the next page loads. */
export const LoadingMoreLine: Story = {
  args: { rows: ROWS.slice(0, 6), total: 120, loadingMore: true },
};

export const Empty: Story = { args: { rows: [], total: 0 } };

export const EmptyWithText: Story = {
  args: { rows: [], total: 0, emptyText: "No line in October matches “bistro”." },
};

export const Loading: Story = {
  render: () => (
    <Frame>
      <OperationsListSkeleton rows={8} />
    </Frame>
  ),
};

export const French: Story = {
  render: (args) => (
    <InFrench>
      <Frame>
        <OperationsList {...args} />
      </Frame>
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Opening rows={ROWS} />,
};
