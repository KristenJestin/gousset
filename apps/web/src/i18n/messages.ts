import { PASSWORD_LENGTH } from "@gousset/auth/password";
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
    case "BALANCE_CATEGORY_UNKNOWN":
      return m.accountRefusalBalanceCategoryUnknown();
    case "BALANCE_CATEGORY_ARCHIVED":
      return m.accountRefusalBalanceCategoryArchived();
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
 * A refusal of the review of a line (`ReviewRefusalCode`, #35), by its code; `FAILED` when the
 * server failed. A refusal of the category chosen says what the operations page says of it.
 */
export function reviewRefusalMessage(code: string): string {
  switch (code) {
    case "LINE_NOT_FOUND":
      return m.operationsTransferLineGone();
    case "ALREADY_REVIEWED":
      return m.reviewRefusalReviewed();
    case "PROPOSAL_CHANGED":
      return m.reviewRefusalChanged();
    case "NOT_HELD":
      return m.reviewRefusalNotHeld();
    case "CANNOT_PAIR":
      return m.reviewRefusalCannotPair();
    case "CANNOT_LINK":
      return m.reviewRefusalCannotLink();
    case "CATEGORY_REQUIRED":
      return m.reviewRefusalCategoryRequired();
    case "LINE_NOT_CLASSIFIABLE":
    case "CATEGORY_NOT_FOUND":
    case "CATEGORY_KIND_MISMATCH":
    case "CATEGORY_ARCHIVED":
      return categoryRefusalMessage(code);
    case "FAILED":
      return m.operationsTransferFailed();
    default:
      return m.errorUnknown();
  }
}

/**
 * A merchant write or read's refusal (`MerchantRefusalCode`), by its code; `name` is the merchant
 * it is about, when the refusal names one (the one that has the name already, the intermediary
 * chosen as who was paid).
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
    case "CATEGORY_NOT_FOUND":
      return m.merchantRefusalCategoryNotFound();
    case "CATEGORY_ARCHIVED":
      return m.merchantRefusalCategoryArchived();
    case "LINE_NOT_FOUND":
      return m.merchantRefusalLineNotFound();
    case "NOT_INTERMEDIARY":
      return m.merchantRefusalNotIntermediary();
    case "NOT_ONE_ENTRY":
      return m.merchantRefusalNotOneEntry();
    case "INTERMEDIARY_CHOSEN":
      return name === undefined ? m.errorUnknown() : m.merchantRefusalIntermediaryChosen({ name });
    default:
      return m.errorUnknown();
  }
}

/**
 * A refusal of a rule's read or change (`RuleRefusalCode`), by its code; `index` is the condition
 * it is about (from 0), when one is the cause; `limit` the server's limit a refusal names (the most
 * conditions, the most rules).
 */
export function ruleRefusalMessage(
  code: string,
  index: number | null = null,
  limit: number | null = null,
): string {
  const condition = (index ?? 0) + 1;

  switch (code) {
    case "RULE_NOT_FOUND":
      return m.ruleRefusalNotFound();
    case "CONDITIONS_EMPTY":
      return m.ruleRefusalConditionsEmpty();
    case "CONDITIONS_TOO_MANY":
      return m.ruleRefusalConditionsTooMany({ max: limit ?? 0 });
    case "CONDITION_INVALID":
      return m.ruleRefusalConditionInvalid({ index: condition });
    case "CONDITION_UNKNOWN_ACCOUNT":
      return m.ruleRefusalUnknownAccount({ index: condition });
    case "CONDITION_UNKNOWN_MERCHANT":
      return m.ruleRefusalUnknownMerchant({ index: condition });
    case "NOTHING_SET":
      return m.ruleRefusalNothingSet();
    case "CATEGORY_ARCHIVED":
      return m.ruleRefusalCategoryArchived();
    case "CATEGORY_NOT_FOUND":
      return m.ruleRefusalCategoryNotFound();
    case "MERCHANT_NOT_FOUND":
      return m.ruleRefusalMerchantNotFound();
    case "MERCHANT_INTERMEDIARY":
      return m.ruleRefusalMerchantIntermediary();
    case "SUBJECT_ARCHIVED":
      return m.ruleRefusalSubjectArchived();
    case "SUBJECT_NOT_FOUND":
      return m.ruleRefusalSubjectNotFound();
    case "TOO_MANY_RULES":
      return m.ruleRefusalTooMany({ max: limit ?? 0 });
    case "JOB_UNAVAILABLE":
      return m.ruleRefusalJobUnavailable();
    case "LINE_NOT_FOUND":
      return m.ruleRefusalLineNotFound();
    default:
      return m.errorUnknown();
  }
}

/**
 * A refusal of a subject's read or change (`SubjectRefusalCode`, #37), by its code; `limit` the most
 * rules, when a subject's merchants would pass it.
 */
export function subjectRefusalMessage(code: string, limit: number | null = null): string {
  switch (code) {
    case "SUBJECT_NOT_FOUND":
      return m.subjectRefusalNotFound();
    case "SUBJECT_NAME":
      return m.subjectRefusalName();
    case "SUBJECT_NAME_TAKEN":
      return m.subjectRefusalNameTaken();
    case "SUBJECT_PARENT_MISSING":
      return m.subjectRefusalParentMissing();
    case "SUBJECT_PARENT_ARCHIVED":
      return m.subjectRefusalParentArchived();
    case "SUBJECT_CYCLE":
      return m.subjectRefusalCycle();
    case "SUBJECT_VALUE":
      return m.subjectRefusalValue();
    case "SUBJECT_LOAN":
      return m.subjectRefusalLoan();
    case "SUBJECT_ACCOUNT":
      return m.subjectRefusalAccount();
    case "SUBJECT_DATES":
      return m.subjectRefusalDates();
    case "SUBJECT_TOO_MANY":
      return m.subjectRefusalTooMany();
    case "SUBJECT_ARCHIVED":
      return m.subjectRefusalArchived();
    case "SUBJECT_NOT_AN_EXPENSE":
      return m.subjectRefusalNotAnExpense();
    case "SUBJECT_ENTRIES":
      return m.subjectRefusalEntries();
    case "SUBJECT_PERIOD":
      return m.subjectRefusalPeriod();
    case "SUBJECT_PAYBACK":
      return m.subjectRefusalPayback();
    case "SUBJECT_PAYBACK_LINES":
      return m.subjectRefusalPaybackLines();
    case "ENTRY_NOT_FOUND":
      return m.subjectRefusalEntryNotFound();
    case "MERCHANT_NOT_FOUND":
    case "TOO_MANY_RULES":
      // A subject's merchants are rules: their refusals are the rules'.
      return ruleRefusalMessage(code, null, limit);
    default:
      return m.errorUnknown();
  }
}

/** A refusal of attaching or detaching a payback line (`PaybackRefusalCode`, #217), by its code. */
export function paybackRefusalMessage(code: string): string {
  switch (code) {
    case "SUBJECT_NOT_FOUND":
      return m.subjectRefusalNotFound();
    case "PAYBACK_LINE_NOT_FOUND":
      return m.paybackRefusalLineNotFound();
    case "PAYBACK_GOING_OUT":
      return m.paybackRefusalGoingOut();
    case "PAYBACK_NOT_COUNTED":
      return m.paybackRefusalNotCounted();
    case "PAYBACK_ZERO_AMOUNT":
      return m.paybackRefusalZeroAmount();
    case "PAYBACK_MADE_FROM_BALANCE":
      return m.paybackRefusalMadeFromBalance();
    case "PAYBACK_SPLIT":
      return m.paybackRefusalSplit();
    case "PAYBACK_LINKED":
      return m.paybackRefusalLinked();
    case "PAYBACK_TRANSFER":
      return m.paybackRefusalTransfer();
    case "PAYBACK_CURRENCY":
      return m.paybackRefusalCurrency();
    case "PAYBACK_OTHER_SUBJECT":
      return m.paybackRefusalOtherSubject();
    case "PAYBACK_NOT_PAID_BACK":
      return m.paybackRefusalNotPaidBack();
    case "PAYBACK_ARCHIVED":
      return m.paybackRefusalArchived();
    case "PAYBACK_LINES":
      return m.paybackRefusalLines();
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
      return m.errorPasswordTooShort(PASSWORD_LENGTH);
    case "PASSWORD_TOO_LONG":
      return m.errorPasswordTooLong(PASSWORD_LENGTH);
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
    case "USER_NOT_FOUND":
      return m.errorUserNotFound();
    default:
      return m.errorUnknown();
  }
}

/**
 * The field a refusal is about, its message shown under it: the e-mail, the password being chosen
 * (or typed, signing in), or the current one when changing it. None for the form as a whole.
 */
export type RefusedField = "email" | "password" | "currentPassword";

export type Refusal = { field: RefusedField | undefined; message: string };

function refusedField(code: string | undefined): RefusedField | undefined {
  switch (code) {
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
    case "PASSWORD_UNCHANGED":
      return "password";
    case "INVALID_PASSWORD":
      return "currentPassword";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
    case "INVALID_EMAIL":
      return "email";
    default:
      return undefined;
  }
}

/** A refusal of better-auth or of Gousset, by its code: what it says, and under which field. */
export function refusalOf(code: string | undefined): Refusal {
  return { field: refusedField(code), message: errorMessage(code) };
}

/** The refusal's message where it belongs: under `field`, or for the whole form (`undefined`). */
export function refusalMessage(
  refusal: Refusal | undefined,
  field: RefusedField | undefined,
): string | undefined {
  return refusal?.field === field ? refusal?.message : undefined;
}

/** What a field that chooses a password says before a submit. */
export const passwordRules = () => m.passwordRules(PASSWORD_LENGTH);
