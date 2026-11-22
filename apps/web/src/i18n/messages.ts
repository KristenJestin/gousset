/** The interface's texts, written in English and translated into French. */
const en = {
  appName: "Gousset",
  fields: {
    name: "Name",
    email: "E-mail",
    password: "Password",
    currentPassword: "Current password",
    newPassword: "New password",
    temporaryPassword: "Temporary password",
  },
  setup: {
    title: "Welcome to Gousset",
    description:
      "Create the first account. It will be the administrator's, who creates the other users.",
    submit: "Create the administrator",
  },
  signIn: {
    title: "Sign in",
    description: "Sign in with the e-mail and password of your account.",
    submit: "Sign in",
  },
  changePassword: {
    title: "Change your password",
    required: "Your password is temporary: choose your own before going on.",
    description: "Other devices signed in to your account will be signed out.",
    submit: "Change the password",
  },
  home: {
    greeting: (name: string) => `Hello, ${name}.`,
    empty: "Nothing to show yet.",
    users: "Users",
    settings: "Settings",
    changePassword: "Change password",
    signOut: "Sign out",
  },
  consent: {
    title: (client: string) => `Allow ${client} to reach your Gousset?`,
    unknownClient: "An MCP client",
    description:
      "It will read your months, accounts and lines from an AI agent, as you. You can revoke it at any time in your settings.",
    writeDescription:
      "It asks to change your data too. Allow read only unless you want it to make changes for you.",
    allowRead: "Allow read only",
    allowReadWrite: "Allow read and write",
    allow: "Allow",
    deny: "Deny",
  },
  settings: {
    title: "Settings",
    back: "Back",
    clientsTitle: "Connected clients",
    clientsDescription: (endpoint: string) =>
      `The AI agents and apps you allowed to reach your data over MCP, at ${endpoint}. Revoking one cuts it off at once.`,
    noClients: "No client is connected.",
    readOnly: "Read only",
    readWrite: "Read and write",
    revoke: "Revoke",
    revokeLabel: (client: string) => `Revoke ${client}`,
    revoked: (client: string) => `${client} can no longer reach your data.`,
    doorTitle: "MCP access",
    doorOpen: "Every user can connect AI agents to their own data.",
    doorClosed: "MCP access is turned off: no AI agent can reach this installation.",
    doorUnavailable:
      "MCP access needs Gousset to be served over HTTPS, or on this machine (localhost). Serve it over HTTPS to turn it on.",
    turnOff: "Turn off MCP access",
    turnOn: "Turn on MCP access",
  },
  users: {
    title: "Users",
    description: "Everyone with an account on this installation.",
    administrator: "Administrator",
    mustChangePassword: "Temporary password",
    createTitle: "Create a user",
    createDescription: "They will choose their own password at their first sign-in.",
    create: "Create the user",
    created: (name: string) => `${name} can now sign in with the temporary password.`,
    back: "Back",
  },
  errors: {
    invalidCredentials: "Wrong e-mail or password.",
    tooManyAttempts: "Too many failed attempts. Try again in a few minutes.",
    signUpClosed: "Sign-up is closed: ask the administrator for an account.",
    passwordTooShort: "The password needs at least 8 characters.",
    wrongCurrentPassword: "The current password is wrong.",
    passwordUnchanged: "The new password must differ from the current one.",
    emailTaken: "An account already uses this e-mail.",
    invalidEmail: "This e-mail is not valid.",
    unknown: "Something went wrong. Try again.",
  },
};

export type Messages = typeof en;

const fr: Messages = {
  appName: "Gousset",
  fields: {
    name: "Nom",
    email: "E-mail",
    password: "Mot de passe",
    currentPassword: "Mot de passe actuel",
    newPassword: "Nouveau mot de passe",
    temporaryPassword: "Mot de passe provisoire",
  },
  setup: {
    title: "Bienvenue dans Gousset",
    description:
      "Créez le premier compte. Ce sera celui de l'administrateur, qui crée les autres utilisateurs.",
    submit: "Créer l'administrateur",
  },
  signIn: {
    title: "Se connecter",
    description: "Connectez-vous avec l'e-mail et le mot de passe de votre compte.",
    submit: "Se connecter",
  },
  changePassword: {
    title: "Changer de mot de passe",
    required: "Votre mot de passe est provisoire : choisissez le vôtre pour continuer.",
    description: "Les autres appareils connectés à votre compte seront déconnectés.",
    submit: "Changer le mot de passe",
  },
  home: {
    greeting: (name) => `Bonjour, ${name}.`,
    empty: "Rien à afficher pour l'instant.",
    users: "Utilisateurs",
    settings: "Paramètres",
    changePassword: "Changer de mot de passe",
    signOut: "Se déconnecter",
  },
  consent: {
    title: (client) => `Autoriser ${client} à accéder à votre Gousset ?`,
    unknownClient: "Un client MCP",
    description:
      "Il lira vos mois, vos comptes et vos lignes depuis un agent IA, en votre nom. Vous pouvez le révoquer à tout moment dans vos paramètres.",
    writeDescription:
      "Il demande aussi à modifier vos données. Autorisez la lecture seule, sauf si vous voulez qu'il fasse des changements pour vous.",
    allowRead: "Autoriser la lecture seule",
    allowReadWrite: "Autoriser la lecture et l'écriture",
    allow: "Autoriser",
    deny: "Refuser",
  },
  settings: {
    title: "Paramètres",
    back: "Retour",
    clientsTitle: "Clients connectés",
    clientsDescription: (endpoint) =>
      `Les agents IA et applications que vous avez autorisés à accéder à vos données par MCP, à l'adresse ${endpoint}. En révoquer un le coupe aussitôt.`,
    noClients: "Aucun client n'est connecté.",
    readOnly: "Lecture seule",
    readWrite: "Lecture et écriture",
    revoke: "Révoquer",
    revokeLabel: (client) => `Révoquer ${client}`,
    revoked: (client) => `${client} ne peut plus accéder à vos données.`,
    doorTitle: "Accès MCP",
    doorOpen: "Chaque utilisateur peut connecter des agents IA à ses propres données.",
    doorClosed: "L'accès MCP est désactivé : aucun agent IA ne peut joindre cette installation.",
    doorUnavailable:
      "L'accès MCP demande que Gousset soit servi en HTTPS, ou sur cette machine (localhost). Servez-le en HTTPS pour l'activer.",
    turnOff: "Désactiver l'accès MCP",
    turnOn: "Activer l'accès MCP",
  },
  users: {
    title: "Utilisateurs",
    description: "Tous ceux qui ont un compte sur cette installation.",
    administrator: "Administrateur",
    mustChangePassword: "Mot de passe provisoire",
    createTitle: "Créer un utilisateur",
    createDescription: "Il choisira son propre mot de passe à sa première connexion.",
    create: "Créer l'utilisateur",
    created: (name) => `${name} peut maintenant se connecter avec le mot de passe provisoire.`,
    back: "Retour",
  },
  errors: {
    invalidCredentials: "E-mail ou mot de passe incorrect.",
    tooManyAttempts: "Trop de tentatives échouées. Réessayez dans quelques minutes.",
    signUpClosed: "L'inscription est fermée : demandez un compte à l'administrateur.",
    passwordTooShort: "Le mot de passe doit faire au moins 8 caractères.",
    wrongCurrentPassword: "Le mot de passe actuel est incorrect.",
    passwordUnchanged: "Le nouveau mot de passe doit être différent de l'actuel.",
    emailTaken: "Un compte utilise déjà cet e-mail.",
    invalidEmail: "Cet e-mail n'est pas valide.",
    unknown: "Une erreur est survenue. Réessayez.",
  },
};

export const locales = ["en", "fr"] as const;

export type Locale = (typeof locales)[number];

const byLocale = { en, fr } satisfies { [locale in Locale]: Messages };

export function messagesFor(locale: Locale): Messages {
  return byLocale[locale];
}

const supported: ReadonlySet<string> = new Set(locales);

function isLocale(language: string | undefined): language is Locale {
  return language !== undefined && supported.has(language);
}

/** The first supported language of an `Accept-Language` header, English otherwise. */
export function pickLocale(acceptLanguage: string | undefined): Locale {
  const wanted = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const quality = params.find((param) => param.trim().startsWith("q="));

      return {
        language: tag.split("-")[0]?.toLowerCase(),
        q: quality ? Number(quality.split("=")[1]) : 1,
      };
    })
    // A fresh array from `map`: sorting it in place touches nothing else.
    .sort((a, b) => b.q - a.q);

  for (const { language } of wanted) {
    if (isLocale(language)) {
      return language;
    }
  }

  return "en";
}

/** The message for a refusal of better-auth or of Gousset, by its code. */
export function errorMessage(messages: Messages, code: string | undefined): string {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return messages.errors.invalidCredentials;
    case "TOO_MANY_ATTEMPTS":
      return messages.errors.tooManyAttempts;
    case "SIGN_UP_CLOSED":
      return messages.errors.signUpClosed;
    case "PASSWORD_TOO_SHORT":
      return messages.errors.passwordTooShort;
    case "INVALID_PASSWORD":
      return messages.errors.wrongCurrentPassword;
    case "PASSWORD_UNCHANGED":
      return messages.errors.passwordUnchanged;
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return messages.errors.emailTaken;
    case "INVALID_EMAIL":
      return messages.errors.invalidEmail;
    default:
      return messages.errors.unknown;
  }
}
