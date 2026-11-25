import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { MADE_UP_LOGO } from "../stories/made-up";
import { LineMerchant } from "./line-merchant";
import type { LineMerchantProps } from "./line-merchant";

const MERCHANTS = ["Greenmarket", "Fuelstop", "Corner Bistro", "Streamly", "Pixelplay"];

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

type AssigningProps = Omit<LineMerchantProps, "onAssign" | "error"> & {
  /** The server refuses every assignment, with these words. */
  refusal?: string;
};

/**
 * The row as the operations page holds it, 340 px wide (about a phone's detail sheet): an
 * assignment takes half a second, long enough to see the button busy, then the line has its merchant.
 */
function Assigning({ refusal, ...props }: AssigningProps) {
  const [merchant, setMerchant] = useState(props.merchant);
  const [asks, setAsks] = useState(props.asks);
  const [error, setError] = useState<string>();

  const assign = async (name: string) => {
    await wait(500);

    if (refusal !== undefined) {
      setError(refusal);

      return false;
    }

    setError(undefined);
    setMerchant(name);
    setAsks(false);

    return true;
  };

  return (
    <div className="flex w-85 max-w-full flex-col gap-3">
      <LineMerchant {...props} merchant={merchant} asks={asks} error={error} onAssign={assign} />
      <p data-testid="assigned" className="text-xs text-muted-foreground">
        {asks ? "Nobody assigned" : `Assigned: ${merchant ?? ""}`}
      </p>
    </div>
  );
}

/**
 * Who a line paid, in its detail (`LineDetail`'s `merchant`), as a "Merchant" row. A direct
 * payment shows its merchant alone. A line paid through an intermediary (PayPal, Lydia, SumUp…)
 * whose merchant nobody knows yet asks, framed in the accent colour: "Who was really paid?",
 * "Paid through PayPal", and "Choose the merchant". Once assigned it shows the merchant with
 * "through PayPal" and "Change". Either button opens a dialog holding a `NameField`: the merchants
 * are suggested as the user types, a new name is kept as typed (the server makes the merchant). A
 * refusal shows under the field and the dialog stays open; Cancel changes nothing. Every name
 * comes from the page.
 *
 * Motion: none of its own; the row does not animate. The dialog is `Dialog`'s, 200 ms in and out,
 * ease-out. Cut under reduced motion.
 *
 * Don't: assign a merchant without the user's choice, or put the field in the detail itself: the
 * form is the dialog's.
 */
const meta = {
  title: "Operations/LineMerchant",
  component: Assigning,
  args: { merchant: null, intermediary: "PayPal", asks: true, merchants: MERCHANTS },
} satisfies Meta<typeof Assigning>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Paid through PayPal, and nobody says who to: it asks. */
export const Asks: Story = {};

/** A direct payment: its merchant alone, nothing to choose. */
export const Plain: Story = {
  args: { merchant: "Greenmarket", intermediary: null, asks: false },
};

/** Paid through PayPal to Pixelplay, as the user said: "Change" opens the dialog again. */
export const Assigned: Story = {
  args: { merchant: "Pixelplay", asks: false },
};

/** A direct payment to a merchant with a logo (#204): its logo before its name. */
export const WithLogo: Story = {
  args: {
    merchant: "Greenmarket",
    avatar: { name: "Greenmarket", src: MADE_UP_LOGO },
    intermediary: null,
    asks: false,
  },
};

/** Paid through PayPal to a merchant without a logo: its initials on the colour picked. */
export const WithInitials: Story = {
  args: { merchant: "Pixelplay", avatar: { name: "Pixelplay", color: "violet" }, asks: false },
};

/**
 * "Change" opens the dialog with the merchant's name in the field; typing offers the merchants
 * that contain the text ("Gr" offers Greenmarket).
 */
export const Choosing: Story = {
  args: {
    merchant: "Pixelplay",
    asks: false,
    merchants: [...MERCHANTS, "Greenway Bakery", "Harbor Books", "Riverside Cafe"],
  },
};

/** The server refuses the name: the reason under the field, the dialog still open. */
export const Refused: Story = {
  args: { refusal: "The merchant could not be assigned. Try again." },
};

/** A long merchant's name and a long intermediary's, as they wrap in the column. */
export const LongNames: Story = {
  args: {
    merchant: "Riverside Community Cafe and Bakery Cooperative",
    intermediary: "Northbank Instant Payments",
    asks: false,
  },
};

export const French: Story = {
  render: (args) => (
    <InFrench>
      <div className="flex flex-col gap-6">
        <Assigning {...args} />
        <Assigning {...args} merchant="Pixelplay" asks={false} />
      </div>
    </InFrench>
  ),
};

/** On a phone, in the detail that takes the screen's width; the dialog is a bottom sheet. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
