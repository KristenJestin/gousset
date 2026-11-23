import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import {
  AccountGroup,
  AccountRow,
  AccountsOverviewSkeleton,
  AccountsTotals,
  ClosedAccounts,
} from "./accounts-overview";
import type { AccountsOverviewTotal } from "./accounts-overview";
import { Button } from "./button";

const eur = (minor: number) => ({ minor, currency: "EUR" });

const TOTALS: ReadonlyArray<AccountsOverviewTotal> = [
  { id: "available", label: "Available", amounts: [eur(186_000)] },
  { id: "invested", label: "Savings and investments", amounts: [eur(1_341_000)] },
  { id: "restricted", label: "Restricted use", amounts: [eur(45_200)] },
  { id: "owed", label: "Loans", amounts: [eur(-6_890_000)] },
];

/** The full page as the app would compose it, each row a link (here a plain anchor). */
function Overview() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <AccountsTotals totals={TOTALS} />
      <AccountGroup id="available" title="Available" totals={[eur(186_000)]} index={0}>
        <AccountRow
          href="#current"
          name="Current account"
          institution="Northbank"
          tracking="lines"
          through="31 Oct."
          balance={eur(186_000)}
          index={0}
        />
      </AccountGroup>
      <AccountGroup
        id="invested"
        title="Savings and investments"
        totals={[eur(1_341_000)]}
        index={1}
      >
        <AccountRow
          href="#livret"
          name="Livret A"
          envelope="Livret A"
          institution="Northbank"
          tracking="lines"
          through="31 Oct."
          balance={eur(923_000)}
          index={0}
        />
        <AccountRow
          href="#pea"
          name="Northbank PEA"
          envelope="PEA"
          institution="Northbank"
          tracking="lines"
          through="31 Oct."
          balance={eur(418_000)}
          index={1}
        />
      </AccountGroup>
      <AccountGroup id="restricted" title="Restricted use" totals={[eur(45_200)]} index={2}>
        <AccountRow
          href="#mealcard"
          name="MealCard"
          institution="MealCard"
          tracking="lines"
          through="24 Oct."
          behind
          balance={eur(14_000)}
          restricted
          index={0}
        />
        <AccountRow
          href="#perkshub"
          name="PerksHub"
          institution="Works council"
          tracking="balance"
          through="noted on 26 Oct."
          balance={eur(31_240)}
          restricted
          index={1}
        />
      </AccountGroup>
      <AccountGroup id="owed" title="Loans" totals={[eur(-6_890_000)]} index={3}>
        <AccountRow
          href="#loan"
          name="Home loan"
          institution="Harbor Savings"
          tracking="balance"
          through="5 Oct."
          balance={eur(-6_890_000)}
          index={0}
        />
      </AccountGroup>
      <ClosedAccounts count={1}>
        <AccountRow
          href="#old-savings"
          name="Old savings account"
          institution="Northbank"
          tracking="lines"
          through="2 Jan. 2021"
          balance={eur(0)}
          closed
        />
      </ClosedAccounts>
    </div>
  );
}

/** A newly created account, added at the top of its group: it slides in from the side. */
function AddingAnAccount() {
  const [added, setAdded] = useState(false);

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <AccountGroup
        id="available"
        title="Available"
        totals={added ? [eur(236_000)] : [eur(186_000)]}
      >
        {added ? (
          <AccountRow
            href="#mealcard-new"
            name="New current account"
            institution="Northbank"
            tracking="lines"
            through={null}
            balance={eur(50_000)}
            justCreated
          />
        ) : null}
        <AccountRow
          href="#current"
          name="Current account"
          institution="Northbank"
          tracking="lines"
          through="31 Oct."
          balance={eur(186_000)}
        />
      </AccountGroup>
      <Button variant="secondary" onClick={() => setAdded(true)} disabled={added}>
        Add an account
      </Button>
    </div>
  );
}

/**
 * The accounts overview (docs/wireframes, screen 3): the four totals (never converted across
 * currencies), then the accounts grouped by `available`, `invested` ("savings and investments",
 * which also holds plain savings accounts), `restricted` (hatched) and `owed` (a loan's total is
 * negative); closed accounts sit apart, collapsed. A row is a single link to the account's page.
 *
 * Loading: `AccountsOverviewSkeleton`, as many groups and rows as the page will show.
 *
 * Motion: groups and rows fade and slide up on first paint, staggered; a newly created account
 * slides in from the side instead. Cut under reduced motion.
 *
 * Don't: show a group with nothing in it, or convert a currency into another in a total.
 */
const meta = {
  title: "Accounts/Overview",
  component: Overview,
} satisfies Meta<typeof Overview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AddingAccount: Story = { render: () => <AddingAnAccount /> };

export const Loading: Story = { render: () => <AccountsOverviewSkeleton /> };

/** On a French page (`<html lang="fr">`): amounts and words in French. */
export const French: Story = {
  render: () => (
    <InFrench>
      <Overview />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Overview />,
};
