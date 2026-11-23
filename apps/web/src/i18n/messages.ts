import { m } from "@gousset/i18n/messages";

/** What a failed job says, by its failure's code (`JobFailed`, `FAILURES`): what to do. */
export function jobFailureMessage(code: string | null): string {
  switch (code) {
    case "INTERRUPTED":
      return m.jobFailureInterrupted();
    case "INVALID_INPUT":
      return m.jobFailureInvalidInput();
    case "TEST_FAILURE":
      return m.jobFailureTest();
    default:
      return m.jobFailureUnexpected();
  }
}

/** An account write or read's refusal (`AccountRefusalCode`), by its code. */
export function accountRefusalMessage(code: string): string {
  switch (code) {
    case "ACCOUNT_NOT_FOUND":
      return m.accountRefusalNotFound();
    case "CURRENCY_LOCKED":
      return m.accountRefusalCurrencyLocked();
    case "SETTLES_INTO_REQUIRED":
      return m.accountRefusalSettlesIntoRequired();
    case "SETTLES_INTO_ONLY_FOR_A_CARD":
      return m.accountRefusalSettlesIntoOnlyForCard();
    case "SETTLES_INTO_NOT_AN_OPEN_CURRENT_ACCOUNT":
      return m.accountRefusalSettlesIntoNotOpen();
    case "ACCOUNT_ALREADY_CLOSED":
      return m.accountRefusalAlreadyClosed();
    case "ACCOUNT_NOT_CLOSED":
      return m.accountRefusalNotClosed();
    case "ACCOUNT_KEPT_BY_LINES":
      return m.accountRefusalKeptByLines();
    case "BALANCE_ALREADY_NOTED":
      return m.accountRefusalBalanceAlreadyNoted();
    case "DAY_RANGE_INVALID":
      return m.accountRefusalDayRangeInvalid();
    case "LINE_NOT_FOUND":
      return m.accountRefusalLineNotFound();
    case "NOT_A_CREDIT":
      return m.accountRefusalNotACredit();
    case "EXPIRY_BEFORE_CREDIT":
      return m.accountRefusalExpiryBeforeCredit();
    default:
      return m.errorUnknown();
  }
}

/**
 * A refusal of a change of the categories (`CategoryRefusalCode`) or of a line's category
 * (`LineRefusalCode`), by its code. An icon or a position the page never sends falls to the
 * general message. `fallback` names the fallback a refusal is about, as the user called it.
 */
export function categoryRefusalMessage(code: string, fallback?: string | null): string {
  switch (code) {
    case "CATEGORY_NOT_FOUND":
      return m.categoryRefusalNotFound();
    case "CATEGORY_NAME_TAKEN":
      return m.categoryRefusalNameTaken();
    case "CATEGORY_THIRD_LEVEL":
      return m.categoryRefusalThirdLevel();
    case "CATEGORY_PARENT_KIND":
      return m.categoryRefusalParentKind();
    case "CATEGORY_ITSELF":
      return m.categoryRefusalItself();
    case "CATEGORY_ARCHIVED":
      return m.categoryRefusalArchived();
    case "CATEGORY_PARENT_ARCHIVED":
      return m.categoryRefusalParentArchived();
    case "CATEGORY_FALLBACK":
      return m.categoryRefusalFallback({ name: fallback ?? "" });
    case "CATEGORY_NAME":
      return m.categoryRefusalName();
    case "CATEGORY_TOO_MANY":
      return m.categoryRefusalTooMany();
    case "CATEGORY_BENCHMARK":
      return m.categoryRefusalBenchmark();
    case "CATEGORY_KIND_MISMATCH":
      return m.categoryRefusalKindMismatch();
    case "LINE_NOT_CLASSIFIABLE":
      return m.categoryRefusalNotClassifiable();
    case "LINE_NOT_FOUND":
      return m.categoryRefusalLineNotFound();
    default:
      return m.errorUnknown();
  }
}

/**
 * A merchant write or read's refusal (`MerchantRefusalCode`), by its code; `name` is the merchant
 * it is about, when the refusal names one (the one that has the name already).
 */
export function merchantRefusalMessage(code: string, name?: string): string {
  switch (code) {
    case "MERCHANT_NOT_FOUND":
      return m.merchantRefusalNotFound();
    case "NAME_BLANK":
      return m.merchantRefusalNameBlank();
    case "NAME_TOO_LONG":
      return m.merchantRefusalNameTooLong();
    case "NAME_TAKEN":
      return name === undefined ? m.errorUnknown() : m.merchantRefusalNameTaken({ name });
    case "LABEL_NOT_FOUND":
      return m.merchantRefusalLabelNotFound();
    case "MERGE_INTO_ITSELF":
      return m.merchantRefusalMergeIntoItself();
    case "MERGE_INTO_UNKNOWN":
      return m.merchantRefusalMergeIntoUnknown();
    default:
      return m.errorUnknown();
  }
}

/** The message for a refusal of better-auth or of Gousset, by its code. */
export function errorMessage(code: string | undefined): string {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return m.errorInvalidCredentials();
    case "TOO_MANY_ATTEMPTS":
      return m.errorTooManyAttempts();
    case "SIGN_UP_CLOSED":
      return m.errorSignUpClosed();
    case "PASSWORD_TOO_SHORT":
      return m.errorPasswordTooShort();
    case "INVALID_PASSWORD":
      return m.errorWrongCurrentPassword();
    case "PASSWORD_UNCHANGED":
      return m.errorPasswordUnchanged();
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return m.errorEmailTaken();
    case "INVALID_EMAIL":
      return m.errorInvalidEmail();
    case "SIGN_IN_REQUIRED":
      return m.errorSignInRequired();
    case "ADMIN_ONLY":
      return m.errorAdminOnly();
    case "CANNOT_RESET_ADMINISTRATOR":
      return m.errorCannotResetAdministrator();
    case "PASSWORD_CHANGE_REQUIRED":
      return m.errorPasswordChangeRequired();
    case "PASSWORD_TOO_LONG":
      return m.errorPasswordTooLong();
    case "USER_NOT_FOUND":
      return m.errorUserNotFound();
    default:
      return m.errorUnknown();
  }
}
