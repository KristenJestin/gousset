import type { StartingPoints } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import type { Locale } from "@gousset/i18n/runtime";
import { Page } from "@gousset/ui/components/app-shell";
import { ReviewComing } from "@gousset/ui/components/review-coming";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { AppReviewComingLink } from "@/components/app-link";
import { shortDay } from "@/lib/account-day";
import { reviewQueries } from "@/queries/review";

// The formatters, one per language, built once when the module loads: building one is slow.
const numbers = {
  en: new Intl.NumberFormat("en"),
  fr: new Intl.NumberFormat("fr"),
} satisfies { [Language in Locale]: Intl.NumberFormat };

const plurals = {
  en: new Intl.PluralRules("en"),
  fr: new Intl.PluralRules("fr"),
} satisfies { [Language in Locale]: Intl.PluralRules };

/**
 * The monthly review, the home, until it reads the user's own lines (v0.4): no figure, no name,
 * nothing invented (#126). It says what the review will hold and leads to what works today.
 */
export const Route = createFileRoute("/_authed/")({
  // The block comes with the page, filled in: no skeleton promises data that is not coming.
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData(reviewQueries.startingPoints());
  },
  component: Review,
});

function Review() {
  const { data } = useSuspenseQuery(reviewQueries.startingPoints());

  return (
    <Page title={m.reviewTitle()}>
      <ReviewComing
        title={m.reviewComingTitle()}
        description={m.reviewComingDescription()}
        partsLabel={m.reviewComingParts()}
        parts={[
          { part: "income", title: m.reviewPartIncome(), description: m.reviewPartIncomeText() },
          { part: "spent", title: m.reviewPartSpent(), description: m.reviewPartSpentText() },
          { part: "saved", title: m.reviewPartSaved(), description: m.reviewPartSavedText() },
          { part: "left", title: m.reviewPartLeft(), description: m.reviewPartLeftText() },
        ]}
        linksTitle={m.reviewWorksToday()}
      >
        <Links counts={data} />
      </ReviewComing>
    </Page>
  );
}

/** The screens that work today: a new user's first import first, then each with its count. */
function Links({ counts }: { counts: StartingPoints }) {
  const locale = getLocale();
  const number = numbers[locale];
  const isOne = (value: number) => plurals[locale].select(value) === "one";

  const accounts = { count: number.format(counts.accounts) };
  const lines = { count: number.format(counts.lines) };
  const linesText = isOne(counts.lines) ? m.reviewLinesOne(lines) : m.reviewLinesOther(lines);

  const operationsCount =
    counts.lines + counts.toReview === 0
      ? m.reviewNoneYet()
      : counts.toReview === 0
        ? linesText
        : m.reviewLinesToReview({ lines: linesText, toReview: number.format(counts.toReview) });

  return (
    <>
      {counts.lastImportOn === null ? (
        <AppReviewComingLink
          to="/import"
          icon="import"
          title={m.reviewFirstImport()}
          description={m.reviewFirstImportText()}
          first
        />
      ) : null}
      <AppReviewComingLink
        to="/accounts"
        icon="accounts"
        title={m.navAccounts()}
        description={m.reviewAccountsText()}
        count={
          counts.accounts === 0
            ? m.reviewNoneYet()
            : isOne(counts.accounts)
              ? m.reviewAccountsOne(accounts)
              : m.reviewAccountsOther(accounts)
        }
      />
      {counts.lastImportOn === null ? null : (
        <AppReviewComingLink
          to="/import"
          icon="import"
          title={m.navImport()}
          description={m.reviewImportText()}
          count={m.reviewLastImport({ day: shortDay(counts.lastImportOn, locale) })}
        />
      )}
      <AppReviewComingLink
        to="/operations"
        icon="operations"
        title={m.navOperations()}
        description={m.reviewOperationsText()}
        count={operationsCount}
      />
    </>
  );
}
