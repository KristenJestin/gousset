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
      empty: m.uiMoneyEmpty({}, options),
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
