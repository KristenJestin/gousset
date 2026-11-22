import { m } from "@gousset/i18n/messages";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Count } from "./amount";
import { Page, ScreenTransition } from "./app-shell";
import { Breakdown } from "./breakdown";
import { Block } from "./data-block";
import { Delta } from "./delta";
import { FlagList } from "./flag-list";
import { Folded } from "./folded";
import { InvestmentList } from "./investment-list";
import { MonthBar } from "./month-bar";
import { MonthSwitcher } from "./month-switcher";
import { MovementList } from "./movement-list";
import { CountChip, JumpLink, ReviewCell, ReviewGrid, ReviewStatus, StatusPiece } from "./review-layout";
import { ReviewLines } from "./review-lines";
import { Tab, Tabs, TabsList, TabsPanel } from "./tabs";

// The server's markup carries no `style` attribute: the Content Security Policy forbids them
// (apps/web/src/security.ts), and the browser would report each one.

const eur = (minor: number) => ({ minor, currency: "EUR" });

describe("the review's components on the server", () => {
  it("the month switcher writes no style attribute", () => {
    expect(
      renderToString(<MonthSwitcher value={{ year: 2026, month: 10 }} onChange={() => {}} />),
    ).not.toMatch(/style=/);
  });

  it("the screen's transition writes no style attribute", () => {
    expect(
      renderToString(
        <ScreenTransition id="/">
          <Page title={m.reviewTitle()}>{m.reviewMadeUp()}</Page>
        </ScreenTransition>,
      ),
    ).not.toMatch(/style=/);
  });

  it("the blocks write no style attribute", () => {
    const markup = renderToString(
      <>
        <ReviewStatus
          status={
            <StatusPiece>
              <JumpLink to="to-review">{m.reviewToReviewTitle()}</JumpLink>
            </StatusPiece>
          }
          notice={m.reviewMadeUp()}
        />
        <MonthBar
          received={eur(312_000)}
          spent={eur(203_000)}
          saved={eur(60_000)}
          left={eur(49_000)}
          restricted={eur(12_000)}
          comparison={<Delta value={eur(203_000)} reference={eur(193_000)} referenceLabel={m.reviewAverage()} />}
        />
        <ReviewGrid>
          <ReviewCell column="main">
            <Block title={m.reviewSpendingTitle()}>
              <Tabs value="category">
                <TabsList label={m.reviewSpendingTitle()}>
                  <Tab value="category">{m.reviewTabCategories()}</Tab>
                </TabsList>
                <TabsPanel value="category">
                  <Breakdown
                    rows={[{ id: "housing", name: "Housing", amount: eur(69_000), benchmark: eur(69_000) }]}
                    onSelect={() => {}}
                  />
                </TabsPanel>
              </Tabs>
            </Block>
          </ReviewCell>
          <ReviewCell column="side">
            <Block
              title={m.reviewToReviewTitle()}
              badge={
                <CountChip>
                  <Count value={6} />
                </CountChip>
              }
              foldOnPhone
            >
              <Folded title={m.reviewToReviewTitle()} summary={<Count value={6} />}>
                <ReviewLines
                  lines={[
                    {
                      id: "l1",
                      label: "PAYLINK *PIXELPLAY",
                      title: "Pixelplay",
                      tags: ["Leisure"],
                      amount: eur(-1499),
                    },
                  ]}
                  approveText={m.reviewApprove()}
                  approveLabel={(line) => m.reviewApproveLine({ label: line.label })}
                  onApprove={() => {}}
                  label={m.reviewToReviewTitle()}
                />
              </Folded>
            </Block>
            <MovementList
              movements={[
                {
                  id: "t1",
                  from: "Current account",
                  to: "Northbank PEA",
                  amount: eur(35_000),
                  bought: { name: "World index ETF", amount: eur(33_500) },
                },
              ]}
              label={m.reviewMovementsTitle()}
              emptyText={m.reviewMovementsEmpty()}
            />
            <InvestmentList
              accounts={[
                {
                  id: "pea",
                  account: "Northbank PEA",
                  value: eur(418_000),
                  netContributions: eur(390_000),
                },
              ]}
              label={m.investmentsTitle()}
              emptyText={m.reviewInvestmentsEmpty()}
            />
            <FlagList
              flags={[{ id: "f1", icon: "subscriptions", text: "Streamly" }]}
              label={m.reviewFlagsTitle()}
              emptyText={m.reviewFlagsEmpty()}
            />
          </ReviewCell>
        </ReviewGrid>
      </>,
    );

    expect(markup).not.toMatch(/style=/);
  });
});
