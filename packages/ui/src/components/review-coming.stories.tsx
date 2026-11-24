import type { Meta, StoryObj } from "@storybook/react-vite";

import { ReviewComing, ReviewComingLink } from "./review-coming";

/**
 * The monthly review until it reads the user's own lines: what the review will hold (its four
 * parts, in words, each in the colour it keeps), then the screens that work today, with the user's
 * own counts. A new user sees "Import your first statement" first, in the accent.
 *
 * Motion: none on load, no skeleton, nothing counts up. A row takes the muted band on hover
 * (150 ms) and its chevron moves 2 px right; under reduced motion, the band only.
 *
 * Don't: put a figure, a chart or a skeleton in it (no data is on its way), or an illustration.
 */
const meta = {
  title: "States/ReviewComing",
  component: ReviewComing,
  args: {
    title: "Your monthly review is not ready yet",
    description:
      "It will read your imported lines month by month, and say where the money went. It comes in a later version; until then, nothing here is invented.",
    partsLabel: "What the review will hold",
    parts: [
      { part: "income", title: "Income", description: "What came in." },
      { part: "spent", title: "Spent", description: "By subject." },
      { part: "saved", title: "Set aside", description: "Savings, investments." },
      { part: "left", title: "Left", description: "What the month leaves." },
    ],
    linksTitle: "What works today",
    children: null,
  },
} satisfies Meta<typeof ReviewComing>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A user with imported lines: their counts at each row's end. */
export const WithData: Story = {
  render: (args) => (
    <ReviewComing {...args}>
      <ReviewComingLink
        href="#accounts"
        icon="accounts"
        title="Accounts"
        description="Each balance, its lines and its chart."
        count="5 accounts"
      />
      <ReviewComingLink
        href="#import"
        icon="import"
        title="Import"
        description="Add your banks' statements; nothing is added twice."
        count="Last on 2 Nov"
      />
      <ReviewComingLink
        href="#operations"
        icon="operations"
        title="Operations"
        description="Search and filter every imported line."
        count="4,838 lines · 14 to review"
      />
    </ReviewComing>
  ),
};

/** A new user: the first import first, in the accent; the counts say none yet. */
export const NewUser: Story = {
  render: (args) => (
    <ReviewComing {...args}>
      <ReviewComingLink
        href="#import"
        icon="import"
        title="Import your first statement"
        description="OFX, QIF, CAMT.053, MT940 or CSV from your bank."
        first
      />
      <ReviewComingLink
        href="#accounts"
        icon="accounts"
        title="Accounts"
        description="Each balance, its lines and its chart."
        count="None yet"
      />
      <ReviewComingLink
        href="#operations"
        icon="operations"
        title="Operations"
        description="Search and filter every imported line."
        count="None yet"
      />
    </ReviewComing>
  ),
};

/** One column: the parts under each other, each count under its row's title. */
export const Phone: Story = {
  ...WithData,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
