import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { MADE_UP_LOGO, MERCHANTS, madeUpOperations } from "../stories/made-up";
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

/** The first page of another search, as long as the last one's. */
const SEARCHED_AGAIN: ReadonlyArray<OperationRow> = TEN_THOUSAND.slice(0, PAGE).map((row) => ({
  ...row,
  id: `again-${row.id}`,
}));

/**
 * A new search whose first page is as long as the last one's: scrolled to its end, it asks for its
 * own next page, as the last one did. The pages never come; the asks are counted.
 */
function NewSearch() {
  const [again, setAgain] = useState(false);
  const [asked, setAsked] = useState(0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setAgain(!again)}>
          Search again
        </Button>
        <output>Next page asked {asked} times</output>
      </div>
      <Frame>
        <OperationsList
          rows={again ? SEARCHED_AGAIN : TEN_THOUSAND.slice(0, PAGE)}
          total={TEN_THOUSAND.length}
          onEnd={() => setAsked((count) => count + 1)}
          onOpen={() => undefined}
          label="Operations"
        />
      </Frame>
    </div>
  );
}

/**
 * Every statement line, newest first (screen 2, block 2): its day, its raw label with a "To
 * review" chip on a held line, its category with `withCategory` (from a laptop's width), its
 * subjects' chips with `withSubjects` (wider still, two and "+N", #37), its account (from a
 * tablet's width) and its amount, in tabular
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
 * gone ones fade out (200 ms, ease-out); scrolling moves nothing but the scroll. A subject's chip
 * that comes to a row fades in, one that goes fades out (150 ms). Opening a line, its `LineDetail`
 * grows out of the row (`operationLayoutId`). Cut under reduced motion. A row's chips ("To review",
 * "Maybe a refund") have no motion of their own: they come and go with the row, and an answered
 * line's chip goes at once when the list is read again.
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

/** Each line's category, in a column of its own from a laptop's width. */
export const WithCategory: Story = {
  args: {
    withCategory: true,
    rows: ROWS.map((row, index) => ({
      ...row,
      category: ["Groceries › Supermarket", "Housing › Rent", "Other"][index % 3],
    })),
  },
};

/** What each line's expense is for (#37): two chips at most, "+N" for the others; most have none. */
const SUBJECTS = [
  [{ id: "van", name: "Van" }],
  [],
  [
    { id: "van", name: "Van" },
    { id: "alps", name: "Alps 2026" },
  ],
  [],
  [
    { id: "house", name: "House" },
    { id: "shed", name: "Garden shed" },
    { id: "van", name: "Van" },
  ],
];

/** The subjects, in a column of their own beside the category, from a wide list. */
export const WithSubjects: Story = {
  args: {
    withCategory: true,
    withSubjects: true,
    rows: ROWS.map((row, index) => ({
      ...row,
      category: ["Groceries › Supermarket", "Housing › Rent", "Other"][index % 3],
      subjects: SUBJECTS[index % SUBJECTS.length],
    })),
  },
};

/**
 * Who each line paid (#204), before its label: a logo, or initials on a colour; a line with no
 * merchant keeps the room empty, so that the labels line up.
 */
export const WithAvatars: Story = {
  args: {
    withAvatars: true,
    withCategory: true,
    rows: ROWS.map((row, index) => {
      const merchant = MERCHANTS[index % (MERCHANTS.length + 1)];

      return {
        ...row,
        category: ["Groceries › Supermarket", "Housing › Rent", "Other"][index % 3],
        avatar:
          merchant === undefined
            ? undefined
            : {
                name: merchant.name,
                src: merchant.id === "greenmarket" ? MADE_UP_LOGO : undefined,
              },
      };
    }),
  },
};

/** The same, on a phone: the label gives way, never the avatar nor the amount. */
export const WithAvatarsOnPhone: Story = {
  ...WithAvatars,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

/** Rows with their category, and a purchase's refund that may be one (#208). */
const MAYBE_REFUND_ROWS: ReadonlyArray<OperationRow> = [
  {
    id: "line-refund",
    day: "Oct 4",
    label: "CARD PIXELPLAY STORE",
    account: "Current account",
    amount: { minor: 3000, currency: "EUR" },
    category: "Other",
    maybeRefund: true,
  },
  {
    id: "line-purchase",
    day: "Oct 3",
    label: "CARD PIXELPLAY STORE",
    account: "Current account",
    amount: { minor: -9000, currency: "EUR" },
    category: "Leisure › Games",
  },
  ...ROWS.slice(0, 6).map((row) => ({ ...row, category: "Groceries › Supermarket" })),
];

/**
 * Maybe a refund (#208): a line coming back that may cancel a purchase, not answered yet. It is no
 * income: a "Maybe a refund" chip beside its label, and no category, which would read as one.
 */
export const MaybeRefund: Story = {
  args: { withCategory: true, rows: MAYBE_REFUND_ROWS, total: MAYBE_REFUND_ROWS.length },
};

export const MaybeRefundFrench: Story = {
  args: MaybeRefund.args,
  render: (args) => (
    <InFrench>
      <Frame>
        <OperationsList {...args} />
      </Frame>
    </InFrench>
  ),
};

/** A line open: its row is marked and kept in the page wherever the list is scrolled. */
export const LineOpen: Story = { args: { openId: "line-3" } };

/** Toggling the lines to review: the rows that stay slide, the others fade out or in. */
export const ChangingRows: Story = { render: () => <Filtering /> };

/** The next page loads near the end, said by a line under the rows. */
export const LoadingMore: Story = { render: () => <Paging /> };

/** A new search as long as the last one asks for its next page too. */
export const SearchingAgain: Story = { render: () => <NewSearch /> };

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
