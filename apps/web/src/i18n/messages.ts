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
