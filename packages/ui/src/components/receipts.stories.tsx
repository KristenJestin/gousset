import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { LineReceipts, SubjectReceipts, SubjectReceiptsSkeleton } from "./receipts";
import type { ReceiptView } from "./receipts";

/** The made-up receipts of a work trip's hotel line. */
const RECEIPTS: ReadonlyArray<ReceiptView> = [
  { id: "invoice", fileName: "hotel-invoice.pdf", href: "#invoice", detail: "PDF · 240 KB" },
  { id: "photo", fileName: "receipt-photo.jpg", href: "#photo", detail: "JPEG · 2.4 MB" },
];

const HINT = "PDF, JPEG, PNG, and HEIC, 50 MB at most.";

/**
 * The list as a line's detail holds it: a file chosen is attached (one named "too-large" is
 * refused, naming the limit); a receipt deleted goes, unless `refuse`.
 */
function Attaching({ refuse = false, empty = false }: { refuse?: boolean; empty?: boolean }) {
  const [receipts, setReceipts] = useState<ReadonlyArray<ReceiptView>>(empty ? [] : RECEIPTS);

  return (
    <LineReceipts
      receipts={receipts}
      accept=".pdf,.jpg,.jpeg,.png,.heic"
      hint={HINT}
      onAttach={async (file) => {
        if (refuse || file.name.includes("too-large")) {
          return "This file is 63 MB; a receipt can be at most 50 MB.";
        }

        setReceipts([
          ...receipts,
          { id: file.name, fileName: file.name, href: "#new", detail: "PDF · 96 KB" },
        ]);

        return undefined;
      }}
      onDelete={async (id) => {
        if (refuse) {
          return false;
        }

        setReceipts(receipts.filter((receipt) => receipt.id !== id));

        return true;
      }}
    />
  );
}

/**
 * Receipts (#217): a photo or a PDF attached to a line. In the line's detail, each receipt is a
 * link that downloads it, with its kind and size, and a delete button that asks first; "Attach a
 * receipt" opens a dialog where a file is chosen, a refusal said in it, naming the limit. On a
 * subject's page (`SubjectReceipts`), every receipt of its lines, its line under it, and "Download
 * all", one zip.
 *
 * Loading: `SubjectReceiptsSkeleton`.
 *
 * Motion: a receipt deleted folds away (200 ms, its opacity), the rows under it sliding up; one
 * attached fades in (200 ms); the dialogs are `Dialog`'s. Cut under reduced motion.
 *
 * Don't: delete a receipt without asking, or attach one from the subject's page: it is a line's.
 */
const meta = {
  title: "Operations/Receipts",
  component: Attaching,
  args: { refuse: false, empty: false },
} satisfies Meta<typeof Attaching>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A hotel line and its two receipts. */
export const Default: Story = {};

/** A line with none yet. */
export const Empty: Story = { args: { empty: true } };

/** The server refuses: the file is said too large, a receipt deleted comes back. */
export const Refused: Story = { args: { refuse: true } };

/** A work trip's page: the receipts of its lines, and the zip of them all. */
export const OnASubject: Story = {
  render: () => (
    <SubjectReceipts
      receipts={[
        {
          id: "invoice",
          fileName: "hotel-invoice.pdf",
          href: "#invoice",
          detail: "CB GRAND HOTEL 0610 · Oct 6",
        },
        {
          id: "report",
          fileName: "expense-report.pdf",
          href: "#report",
          detail: "VIR NORTHWIND CONSULTING · Oct 20",
        },
      ]}
      zipHref="#zip"
      emptyText="No receipt on its lines yet."
    />
  ),
};

/** A subject whose lines have no receipt. */
export const OnASubjectEmpty: Story = {
  render: () => (
    <SubjectReceipts receipts={[]} zipHref="#zip" emptyText="No receipt on its lines yet." />
  ),
};

export const Loading: Story = { render: () => <SubjectReceiptsSkeleton /> };

export const French: Story = {
  render: (args) => (
    <InFrench>
      <Attaching {...args} />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
