import type { Meta, StoryObj } from "@storybook/react-vite";

import { Count } from "./amount";
import { Block } from "./data-block";
import {
  CountChip,
  JumpLink,
  ReviewCell,
  ReviewGrid,
  ReviewStatus,
  StatusPiece,
} from "./review-layout";

function Placeholder({ title, lines }: { title: string; lines: number }) {
  return (
    <Block title={title}>
      <ul className="flex flex-col divide-y text-sm text-muted-foreground">
        {Array.from({ length: lines }, (_, index) => (
          <li key={index} className="flex h-10 items-center">
            Row {index + 1}
          </li>
        ))}
      </ul>
    </Block>
  );
}

/**
 * The monthly review's pieces (screens 1 and 11): the state line under the page's title (the
 * imports, then the link down to the lines to review, separated by dots, and the made-up notice),
 * and the grid of its blocks: two columns on a wide screen, one on a phone, where the lines to
 * review come last.
 *
 * Motion: none of their own; the link scrolls to its block (smoothly, cut under reduced motion).
 */
const meta = {
  title: "Layout/Review layout",
  component: ReviewGrid,
  args: { children: null },
  render: () => (
    <div className="flex max-w-5xl flex-col gap-6">
      <ReviewStatus
        status={
          <>
            <StatusPiece>3 of 4 accounts imported</StatusPiece>
            <StatusPiece>MealCard up to 24 Oct</StatusPiece>
            <StatusPiece>
              <JumpLink to="to-review">6 lines to review</JumpLink>
            </StatusPiece>
          </>
        }
        notice="Made-up data: every account, line and amount here is invented."
      />
      <ReviewGrid>
        <ReviewCell column="main">
          <Placeholder title="Where the money goes" lines={5} />
        </ReviewCell>
        <ReviewCell column="side">
          <Placeholder title="Movements between your accounts" lines={3} />
          <Placeholder title="Investments" lines={1} />
        </ReviewCell>
        <ReviewCell column="main" lastOnPhone>
          <Block
            title="To review"
            anchor="to-review"
            badge={
              <CountChip>
                <Count value={6} locale="en" />
              </CountChip>
            }
          >
            <p className="flex h-10 items-center text-sm text-muted-foreground">Lines</p>
          </Block>
        </ReviewCell>
        <ReviewCell column="side">
          <Placeholder title="Flagged" lines={2} />
        </ReviewCell>
      </ReviewGrid>
    </div>
  ),
} satisfies Meta<typeof ReviewGrid>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

/** On a phone: one column, the lines to review last. */
export const Phone: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
