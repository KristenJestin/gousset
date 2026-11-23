import { m } from "@gousset/i18n/messages";

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
    default:
      return m.errorUnknown();
  }
}
