import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import {
  InvestmentFigures,
  InvestmentFiguresSkeleton,
  InvestmentOperations,
  InvestmentOperationsSkeleton,
  OperationForm,
  PositionsTable,
  PositionsTableSkeleton,
} from "./investments";
import type {
  InvestmentOperationRow,
  OperationFormErrors,
  OperationFormValues,
  PositionRow,
} from "./investments";

// An investment account's page, piece by piece (docs/wireframes, screen 4; #250), on made-up
// data: the Northbank PEA of the fixture, its ISINs in the country code XX, which no country has.

const eur = (minor: number) => ({ minor, currency: "EUR" });

/** What the PEA's cash holds once the month's purchases are paid. */
const CASH = eur(1178);

const POSITIONS: ReadonlyArray<PositionRow> = [
  {
    id: "emerging",
    name: "Emerging Markets ETF",
    isin: "XX0000000010",
    quantity: "4.8873",
    averageCost: { value: "24.5527806355", currency: "EUR" },
    cost: eur(12_000),
    incomplete: false,
  },
  {
    id: "world",
    name: "World Index ETF",
    isin: "XX0000000002",
    quantity: "27.4",
    averageCost: { value: "142.2708029197", currency: "EUR" },
    cost: eur(389_822),
    incomplete: false,
  },
];

const INCOMPLETE: PositionRow = {
  id: "bond",
  name: "Euro bond fund",
  isin: "XX0000000035",
  quantity: "-1.5",
  averageCost: null,
  cost: eur(0),
  incomplete: true,
};

const LONG: PositionRow = {
  id: "long",
  name: "Global sustainable leaders equity index fund, accumulating units, hedged to the euro",
  isin: "XX0000000043",
  quantity: "1234.0347",
  averageCost: { value: "10.0012", currency: "EUR" },
  cost: eur(1_234_183),
  incomplete: false,
};

const WORLD_PURCHASE: InvestmentOperationRow = {
  id: "world",
  day: "14 Oct.",
  kind: "purchase",
  amount: eur(-33_550),
  security: "World Index ETF",
  quantity: "2.2",
  fees: eur(99),
  paired: false,
};

const OPERATIONS: ReadonlyArray<InvestmentOperationRow> = [
  {
    id: "fee",
    day: "28 Oct.",
    kind: "fee",
    amount: eur(-150),
    security: null,
    quantity: null,
    fees: eur(0),
    paired: false,
  },
  WORLD_PURCHASE,
  {
    id: "deposit",
    day: "12 Oct.",
    kind: "deposit",
    amount: eur(35_000),
    security: null,
    quantity: null,
    fees: eur(0),
    paired: true,
  },
  {
    id: "dividend",
    day: "25 Sept.",
    kind: "dividend",
    amount: eur(412),
    security: "Emerging Markets ETF",
    quantity: null,
    fees: eur(52),
    paired: false,
  },
  {
    id: "sale",
    day: "3 Sept.",
    kind: "sale",
    amount: eur(14_210),
    security: "Euro bond fund",
    quantity: "1",
    fees: eur(0),
    paired: false,
  },
  {
    id: "withdrawal",
    day: "1 Sept.",
    kind: "withdrawal",
    amount: eur(-5000),
    security: null,
    quantity: null,
    fees: eur(0),
    paired: false,
  },
];

/**
 * The figures known before prices come (#251): the total at cost, the positions at cost and the
 * cash, each a box of its own, so that the value, the net contributions, the gain and the
 * annualised return (#252) join the row. The envelope and the institution as chips.
 */
const meta = {
  title: "Investments/InvestmentFigures",
  component: InvestmentFigures,
  args: {
    envelope: "PEA",
    institution: "Northbank",
    cash: CASH,
    positionsCost: eur(401_822),
  },
} satisfies Meta<typeof InvestmentFigures>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Figures: Story = {};

/** An account with nothing yet: every figure at zero. */
export const FiguresEmpty: Story = { args: { cash: eur(0), positionsCost: eur(0) } };

export const FiguresClosed: Story = { args: { closed: "Closed on 3 Feb." } };

export const FiguresLoading: Story = { render: () => <InvestmentFiguresSkeleton /> };

export const FiguresFrench: Story = {
  render: (args) => (
    <InFrench>
      <InvestmentFigures {...args} />
    </InFrench>
  ),
};

export const FiguresPhone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

const caption = "Positions of Northbank PEA, at cost";

/** Positions by ISIN, at cost, then the cash; one with no position holds only its cash. */
export const Positions: Story = {
  render: () => <PositionsTable positions={POSITIONS} cash={CASH} label={caption} />,
};

export const PositionsEmpty: Story = {
  render: () => <PositionsTable positions={[]} cash={eur(35_000)} label={caption} />,
};

/** More was sold than held: some earlier operations are missing, whatever came after. */
export const PositionsIncomplete: Story = {
  render: () => (
    <PositionsTable positions={[INCOMPLETE, ...POSITIONS]} cash={CASH} label={caption} />
  ),
};

export const PositionsLongNames: Story = {
  render: () => <PositionsTable positions={[LONG, ...POSITIONS]} cash={CASH} label={caption} />,
};

export const PositionsLoading: Story = { render: () => <PositionsTableSkeleton /> };

export const PositionsFrench: Story = {
  render: () => (
    <InFrench>
      <PositionsTable positions={[INCOMPLETE, ...POSITIONS]} cash={CASH} label={caption} />
    </InFrench>
  ),
};

/** On a phone the ISIN goes under the name, and the average cost leaves. */
export const PositionsPhone: Story = {
  ...PositionsLongNames,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

const label = "Operations of Northbank PEA";

/**
 * The operations, newest first: each kind with its icon, money in or out of the account (the
 * transfer's icon) apart from what happens inside it, money in coloured. A row can be corrected or
 * deleted; older ones come with a button.
 */
export const Operations: Story = {
  render: () => (
    <InvestmentOperations
      rows={OPERATIONS}
      label={label}
      onCorrect={() => undefined}
      onDelete={() => undefined}
      onShowOlder={() => undefined}
    />
  ),
};

export const OperationsEmpty: Story = {
  render: () => <InvestmentOperations rows={[]} label={label} />,
};

export const OperationsLongNames: Story = {
  render: () => (
    <InvestmentOperations
      rows={[
        { ...WORLD_PURCHASE, id: "long", security: LONG.name, quantity: "0.0347" },
        ...OPERATIONS,
      ]}
      label={label}
      onCorrect={() => undefined}
      onDelete={() => undefined}
    />
  ),
};

/** The row just entered slides in from the side; cut under reduced motion. */
export const OperationsJustEntered: Story = {
  render: () => (
    <InvestmentOperations
      rows={OPERATIONS}
      label={label}
      justChanged="world"
      onCorrect={() => undefined}
      onDelete={() => undefined}
    />
  ),
};

export const OperationsOlderFailed: Story = {
  render: () => (
    <InvestmentOperations
      rows={OPERATIONS}
      label={label}
      onShowOlder={() => undefined}
      olderError="Older operations could not be loaded."
    />
  ),
};

export const OperationsLoading: Story = { render: () => <InvestmentOperationsSkeleton /> };

export const OperationsFrench: Story = {
  render: () => (
    <InFrench>
      <InvestmentOperations rows={OPERATIONS} label={label} onCorrect={() => undefined} />
    </InFrench>
  ),
};

export const OperationsPhone: Story = {
  ...Operations,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

const PURCHASE: OperationFormValues = {
  kind: "purchase",
  bookedOn: "2026-10-14",
  amountMinor: 33_550,
  isin: "XX0000000002",
  securityName: "World Index ETF",
  quantity: "2,2",
  unitPrice: "152.05",
  feesMinor: 99,
};

function FormStory({
  initial,
  errors,
}: {
  initial: OperationFormValues;
  errors?: OperationFormErrors;
}) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add an operation</Button>
      <OperationForm
        open={open}
        onOpenChange={setOpen}
        title="Add an operation"
        description="An operation on Northbank PEA, as the broker's statement writes it."
        submitLabel="Add the operation"
        currency="EUR"
        initial={initial}
        errors={errors}
        onSubmit={() => setOpen(false)}
      />
    </>
  );
}

/** A purchase: its security, units, unit price, fees and what the cash paid. */
export const FormPurchase: Story = { render: () => <FormStory initial={PURCHASE} /> };

/** A deposit: a day and an amount, nothing else. */
export const FormDeposit: Story = {
  render: () => (
    <FormStory initial={{ ...PURCHASE, kind: "deposit", amountMinor: 35_000, feesMinor: null }} />
  ),
};

/** A dividend: its ISIN, the amount paid in and the tax withheld. */
export const FormDividend: Story = {
  render: () => (
    <FormStory initial={{ ...PURCHASE, kind: "dividend", amountMinor: 412, feesMinor: 52 }} />
  ),
};

/** A fee: its ISIN only when charged on one security. */
export const FormFee: Story = {
  render: () => (
    <FormStory
      initial={{ ...PURCHASE, kind: "fee", isin: "", amountMinor: 150, feesMinor: null }}
    />
  ),
};

/** A refusal shows under the field at fault: an ISIN whose check digit does not hold. */
export const FormRefused: Story = {
  render: () => (
    <FormStory
      initial={{ ...PURCHASE, isin: "XX0000000003" }}
      errors={{
        isin: "This is not an ISIN: two letters, nine letters or digits, then its check digit. Check it for a typo.",
      }}
    />
  ),
};

export const FormFrench: Story = {
  render: () => (
    <InFrench>
      <FormStory initial={PURCHASE} />
    </InFrench>
  ),
};

export const FormPhone: Story = {
  ...FormPurchase,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
