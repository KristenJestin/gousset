// The texts `packages/ui` writes on its own (a retry button, a toast's wording). They live in
// the app's messages (`packages/i18n/messages`, keys `ui*`), written in English and translated
// into French; this file only gathers them by component family, in one language. A text that
// names the user's data is given by the page as a prop, never written here.
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import type { Locale } from "@gousset/i18n/runtime";

/** Which plural form a count takes, in each language: built once. */
const pluralRules = {
  en: new Intl.PluralRules("en"),
  fr: new Intl.PluralRules("fr"),
} satisfies { [Language in Locale]: Intl.PluralRules };

function uiMessages(locale: Locale) {
  const options = { locale };

  return {
    loading: m.uiLoading({}, options),
    states: {
      errorTitle: m.uiErrorTitle({}, options),
      errorMessage: m.uiErrorMessage({}, options),
      retry: m.uiRetry({}, options),
    },
    pieces: {
      uncategorised: m.uiUncategorised({}, options),
      month: m.uiMonth({}, options),
      previousMonth: m.uiPreviousMonth({}, options),
      nextMonth: m.uiNextMonth({}, options),
      remove: (name: string) => m.uiRemove({ name }, options),
    },
    forms: {
      noMatch: m.uiNoMatch({}, options),
      results: (count: number) =>
        pluralRules[locale].select(count) === "one"
          ? m.uiResultsOne({ count }, options)
          : m.uiResultsOther({ count }, options),
      showOptions: m.uiShowOptions({}, options),
      chooseDate: m.uiChooseDate({}, options),
      previousMonth: m.uiPreviousMonth({}, options),
      nextMonth: m.uiNextMonth({}, options),
      dateFormat: (example: string) => m.uiDateFormat({ example }, options),
      /** The calendar's language (month and day names, the typed date's order). */
      dateLocale: locale,
      /** The calendar's first day of the week, 0 for Sunday. */
      weekStartsOn: locale === "fr" ? 1 : 0,
    },
    overlays: {
      close: m.uiClose({}, options),
      cancel: m.uiCancel({}, options),
    },
    charts: {
      /** The language of the amounts, days and months a chart writes. */
      locale,
      empty: m.uiChartEmpty({}, options),
      /** The button under a chart that opens its figures as a table. */
      showFigures: m.uiChartShowFigures({}, options),
      hideFigures: m.uiChartHideFigures({}, options),
      /** The table's first column. */
      day: m.uiChartDay({}, options),
      month: m.uiMonth({}, options),
    },
    notify: {
      /** The toasts' landmark, reached with F6. */
      region: m.uiNotifyRegion({}, options),
      saved: m.uiNotifySaved({}, options),
      failed: m.uiNotifyFailed({}, options),
      retry: m.uiNotifyRetry({}, options),
      /** A progress toast's title when the caller gives none. */
      working: m.uiNotifyWorking({}, options),
      /** A progress toast resolved without a title of the caller's. */
      done: m.uiNotifyDone({}, options),
      undo: m.uiNotifyUndo({}, options),
      undone: m.uiNotifyUndone({}, options),
      undoFailed: m.uiNotifyUndoFailed({}, options),
      dismiss: m.uiNotifyDismiss({}, options),
      /** Said once a toast's button has been working for a second. */
      pending: m.uiNotifyPending({}, options),
    },
    money: {
      /** After the amount: "€3,120 received". */
      received: m.uiMoneyReceived({}, options),
      /** Each part of the month bar, after its amount. */
      roles: {
        spent: m.uiMoneySpent({}, options),
        saved: m.uiMoneySaved({}, options),
        left: m.uiMoneyLeft({}, options),
      },
      /** Under the part left when some of it sits on benefit accounts. */
      leftRestricted: (amount: string) => m.uiMoneyLeftRestricted({ amount }, options),
      /** In place of "left" when more went out than came in. */
      overspent: m.uiMoneyOverspent({}, options),
      /** The month bar's parts, as a group. */
      parts: m.uiMoneyParts({}, options),
      /** A change and what it is against ("5%", "your 6-month average"). */
      deltaMore: (change: string, reference: string) =>
        m.uiDeltaMore({ change, reference }, options),
      deltaLess: (change: string, reference: string) =>
        m.uiDeltaLess({ change, reference }, options),
      deltaSteady: (reference: string) => m.uiDeltaSteady({ reference }, options),
      overBenchmark: m.uiOverBenchmark({}, options),
      benchmark: (amount: string) => m.uiBenchmark({ amount }, options),
      moreRows: (count: number) => m.uiMoreRows({ count }, options),
      /** The button that shows the rows a list leaves out: never "more", the frame's own menu. */
      showOtherRows: (count: number) => m.uiShowOtherRows({ count }, options),
      empty: m.uiMoneyEmpty({}, options),
      /** A movement into an investment account, then what it bought: "buy World index ETF". */
      bought: (name: string) => m.uiMoneyBought({ name }, options),
      /** What an investment's gain is measured against: its net contributions. */
      putIn: m.uiMoneyPutIn({}, options),
    },
    accounts: {
      /** The "Tracking" column and the settings' value: how the account is followed. */
      trackingLines: m.uiAccountsTrackingLines({}, options),
      trackingBalance: m.uiAccountsTrackingBalance({}, options),
      /** How far statements go, when there is none yet. */
      noStatement: m.uiAccountsNoStatement({}, options),
      /** Beside the date, when the import lags behind the month (⚠). */
      importBehind: m.uiAccountsImportBehind({}, options),
      closed: (count: number) =>
        pluralRules[locale].select(count) === "one"
          ? m.uiAccountsClosedOne({ count }, options)
          : m.uiAccountsClosedOther({ count }, options),
      showOlderLines: m.uiAccountsShowOlderLines({}, options),
      noLines: m.uiAccountsNoLines({}, options),
      balanceChecked: m.uiAccountsBalanceChecked({}, options),
      balanceMismatch: m.uiAccountsBalanceMismatch({}, options),
      balanceAgrees: (app: string, statement: string, day: string) =>
        m.uiAccountsBalanceAgrees({ app, statement, day }, options),
      balanceDisagrees: (app: string, statement: string, day: string, difference: string) =>
        m.uiAccountsBalanceDisagrees({ app, statement, day, difference }, options),
      balanceNoStatement: m.uiAccountsBalanceNoStatement({}, options),
      /** Before the earlier statement balances that disagree, once the latest check is shown. */
      balanceAlsoDiffers: m.uiAccountsBalanceAlsoDiffers({}, options),
      balanceOnDay: (day: string) => m.uiAccountsBalanceOnDay({ day }, options),
      inPeriod: (period: string) => m.uiAccountsInPeriod({ period }, options),
      outPeriod: (period: string) => m.uiAccountsOutPeriod({ period }, options),
      settingsKind: m.uiAccountsSettingsKind({}, options),
      settingsTracking: m.uiAccountsSettingsTracking({}, options),
      settingsCurrency: m.uiAccountsSettingsCurrency({}, options),
      settingsOpenedOn: m.uiAccountsSettingsOpenedOn({}, options),
      settingsInstitution: m.uiAccountsSettingsInstitution({}, options),
      settingsSettlesInto: m.uiAccountsSettingsSettlesInto({}, options),
      settingsNotSet: m.uiAccountsSettingsNotSet({}, options),
      /** A benefit account's setting: the order its credits are used in. */
      settingsCreditOrder: m.uiAccountsSettingsCreditOrder({}, options),
      /** `BenefitCredits`: a benefit account's credits and when they expire. */
      creditsTitle: m.uiAccountsCreditsTitle({}, options),
      creditsExpiring: m.uiAccountsCreditsExpiring({}, options),
      creditsExpiredOn: (day: string) => m.uiAccountsCreditsExpiredOn({ day }, options),
      /** A credit's chip: "expires 31 Dec." */
      creditsExpires: (day: string) => m.uiAccountsCreditsExpires({ day }, options),
      /** After what is left of a credit: "of €200.00". */
      creditsOf: (amount: string) => m.uiAccountsCreditsOf({ amount }, options),
      creditsEditExpiry: m.uiAccountsCreditsEditExpiry({}, options),
      /** The expiry button's name, unique on the page: "Expiry date of MEALCARD CREDIT". */
      creditsEditExpiryOf: (label: string) => m.uiAccountsCreditsEditExpiryOf({ label }, options),
      creditsUncovered: (amount: string) => m.uiAccountsCreditsUncovered({ amount }, options),
      creditsEmpty: m.uiAccountsCreditsEmpty({}, options),
    },
    jobs: {
      /** A background job's state, beside its title. */
      waiting: m.uiJobWaiting({}, options),
      step: (at: number, of: number) => m.uiJobStep({ at, of }, options),
      retrying: (attempt: number, attempts: number) =>
        m.uiJobRetrying({ attempt, attempts }, options),
      completed: m.uiJobCompleted({}, options),
      failed: (attempts: number) =>
        attempts === 1 ? m.uiJobFailedOnce({}, options) : m.uiJobFailedAfter({ attempts }, options),
      /** How much of a step is done: "312 of 1,204". */
      counts: (done: string, total: string) => m.uiJobCounts({ done, total }, options),
      retry: m.uiJobRetry({}, options),
    },
    imports: {
      /** The file drop's button, which opens the file picker. */
      chooseFiles: m.uiImportChooseFiles({}, options),
      /** Said in place of the dash of a value the import has not found yet. */
      notKnown: m.uiImportNotKnown({}, options),
    },
    operations: {
      /** The chip on a line held for review. */
      toReview: m.uiOperationsToReview({}, options),
      empty: m.uiOperationsEmpty({}, options),
      loadingMore: m.uiOperationsLoadingMore({}, options),
      columns: {
        day: m.uiOperationsColumnDay({}, options),
        label: m.uiOperationsColumnLabel({}, options),
        account: m.uiOperationsColumnAccount({}, options),
        category: m.uiOperationsColumnCategory({}, options),
        amount: m.uiOperationsColumnAmount({}, options),
      },
      /** How many lines match, the count already written: "1,234 lines". */
      lines: (count: number, written: string) =>
        pluralRules[locale].select(count) === "one"
          ? m.uiOperationsLinesOne({ count: written }, options)
          : m.uiOperationsLinesOther({ count: written }, options),
      filters: m.uiOperationsFilters({}, options),
      search: m.uiOperationsSearch({}, options),
      searchPlaceholder: m.uiOperationsSearchPlaceholder({}, options),
      account: m.uiOperationsColumnAccount({}, options),
      allAccounts: m.uiOperationsAllAccounts({}, options),
      from: m.uiOperationsFrom({}, options),
      to: m.uiOperationsTo({}, options),
      min: m.uiOperationsMin({}, options),
      max: m.uiOperationsMax({}, options),
      onlyToReview: m.uiOperationsOnlyToReview({}, options),
      clear: m.uiOperationsClear({}, options),
      bookedOn: m.uiOperationsBookedOn({}, options),
      valueOn: m.uiOperationsValueOn({}, options),
      rawLabel: m.uiOperationsRawLabel({}, options),
      memo: m.uiOperationsMemo({}, options),
      counterparty: m.uiOperationsCounterparty({}, options),
      originalAmount: m.uiOperationsOriginalAmount({}, options),
      expiresOn: m.uiOperationsExpiresOn({}, options),
      looksLike: (line: string) => m.uiOperationsLooksLike({ line }, options),
      source: m.uiOperationsSource({}, options),
      importedFrom: m.uiOperationsImportedFrom({}, options),
      importedOn: m.uiOperationsImportedOn({}, options),
      period: m.uiOperationsPeriod({}, options),
      enteredByHand: m.uiOperationsEnteredByHand({}, options),
      /** `LineTransfer`: the transfer a line is a side of, or the lines that may be its other side. */
      transferTo: (account: string) => m.uiOperationsTransferTo({ account }, options),
      transferFrom: (account: string) => m.uiOperationsTransferFrom({ account }, options),
      setAside: m.uiOperationsSetAside({}, options),
      madeByApp: (account: string) => m.uiOperationsMadeByApp({ account }, options),
      notATransfer: m.uiOperationsNotATransfer({}, options),
      unpairTitle: m.uiOperationsUnpairTitle({}, options),
      unpairDescription: m.uiOperationsUnpairDescription({}, options),
      /** The other side was made by the app: unpairing deletes it. */
      unpairDescriptionMade: (account: string) =>
        m.uiOperationsUnpairDescriptionMade({ account }, options),
      unpair: m.uiOperationsUnpair({}, options),
      maybeTransfer: m.uiOperationsMaybeTransfer({}, options),
      pairAsTransfer: m.uiOperationsPairAsTransfer({}, options),
      pairDescription: m.uiOperationsPairDescription({}, options),
      otherSide: m.uiOperationsOtherSide({}, options),
      pair: m.uiOperationsPair({}, options),
      /** `LineExpense`: an expense made of several lines, a split line, a refund proposed. */
      oneExpense: m.uiOperationsOneExpense({}, options),
      oneIncome: m.uiOperationsOneIncome({}, options),
      payments: m.uiOperationsPayments({}, options),
      refunds: m.uiOperationsRefunds({}, options),
      netCost: m.uiOperationsNetCost({}, options),
      netReceived: m.uiOperationsNetReceived({}, options),
      /** The open line among its expense's parts: "This line: CB GREENMARKET". */
      thisLine: (label: string) => m.uiOperationsThisLine({ label }, options),
      separate: m.uiOperationsSeparate({}, options),
      separateTitle: m.uiOperationsSeparateTitle({}, options),
      separateDescription: m.uiOperationsSeparateDescription({}, options),
      separateConfirm: m.uiOperationsSeparateConfirm({}, options),
      splitAcross: (count: number) => m.uiOperationsSplitAcross({ count }, options),
      maybeRefund: m.uiOperationsMaybeRefund({}, options),
      maybeRefundDescription: m.uiOperationsMaybeRefundDescription({}, options),
      /** Under a proposed expense: "Eating out · costs €56.00". */
      proposalCosts: (category: string, amount: string) =>
        m.uiOperationsProposalCosts({ category, amount }, options),
      linkAsRefund: m.uiOperationsLinkAsRefund({}, options),
      linkAsRefundTitle: m.uiOperationsLinkAsRefundTitle({}, options),
      linkAsRefundDescription: (label: string) =>
        m.uiOperationsLinkAsRefundDescription({ label }, options),
      link: m.uiOperationsLink({}, options),
      /** `LinkLine`: a line joins another line's expense. */
      linkToExpense: m.uiOperationsLinkToExpense({}, options),
      linkDescription: m.uiOperationsLinkDescription({}, options),
      linkSearch: m.uiOperationsLinkSearch({}, options),
      linkNone: m.uiOperationsLinkNone({}, options),
      expenseLine: m.uiOperationsExpenseLine({}, options),
      /** `SplitLine`: a line split across categories. */
      split: m.uiOperationsSplit({}, options),
      splitTitle: m.uiOperationsSplitTitle({}, options),
      splitDescription: (amount: string) => m.uiOperationsSplitDescription({ amount }, options),
      shareCategory: (index: number) => m.uiOperationsShareCategory({ index }, options),
      shareAmount: (index: number) => m.uiOperationsShareAmount({ index }, options),
      shareRemove: (index: number) => m.uiOperationsShareRemove({ index }, options),
      splitAdd: m.uiOperationsSplitAdd({}, options),
      splitLeft: (amount: string) => m.uiOperationsSplitLeft({ amount }, options),
      splitOver: (amount: string) => m.uiOperationsSplitOver({ amount }, options),
      splitBalanced: m.uiOperationsSplitBalanced({}, options),
      splitSave: m.uiOperationsSplitSave({}, options),
    },
    categories: {
      columns: {
        category: m.uiCategoriesColumnCategory({}, options),
        average: m.uiCategoriesColumnAverage({}, options),
        benchmark: m.uiCategoriesColumnBenchmark({}, options),
        lines: m.uiCategoriesColumnLines({}, options),
      },
      /** A row's ⋮ menu, unique on the page: "Actions on Groceries". */
      actionsOf: (name: string) => m.uiCategoriesActionsOf({ name }, options),
      /** In place of the average of a category with no line in six months. */
      noAverage: m.uiCategoriesNoAverage({}, options),
    },
  };
}

export type UiMessages = ReturnType<typeof uiMessages>;

export const UI_LOCALES = ["en", "fr"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

/** The supported language of a tag ("fr", "fr-FR"); English for any other. */
export function uiLocaleOf(languageTag: string | undefined): UiLocale {
  return (languageTag ?? "").toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** The ui's texts for a language tag ("fr", "fr-FR"); English for any other. */
export function uiMessagesFor(languageTag: string | undefined): UiMessages {
  return uiMessages(uiLocaleOf(languageTag));
}

/**
 * The ui's texts in the page's language: `<html lang>`, which the app sets; on the server, the
 * request's language (Paraglide's). Read where no React tree is at hand, like `notify`.
 */
export function pageMessages(): UiMessages {
  return uiMessagesFor(
    typeof document === "undefined" ? getLocale() : document.documentElement.lang,
  );
}
