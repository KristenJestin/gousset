import type { Meta, StoryObj } from "@storybook/react-vite";

import { ConsentScreen } from "./consent-screen";
import type { ConsentScreenProps } from "./consent-screen";

const answer = () => undefined;

const english = {
  brandLabel: "Gousset",
  title: "Allow Claude Code to reach your Gousset?",
  origin: "It comes from claude.example.com and will be sent back to 127.0.0.1:53682.",
  readsTitle: "It will read",
  reads: [
    { icon: "accounts", label: "Your accounts and their balances" },
    { icon: "operations", label: "Your lines and your imports" },
    { icon: "review", label: "Your months and their review" },
  ],
  write: {
    title: "It also asks to write",
    summary: "With write, it can change your data as you would",
    detail:
      "Add or edit an account, import a statement, undo an import, note a balance. Allow read only unless you want it to act for you.",
  },
  revoke:
    "You can revoke it at any time in Settings › General › Connected clients. Revoking cuts it off at once.",
  allow: [
    { label: "Allow read only", recommended: "Recommended", onClick: answer },
    { label: "Allow read and write", onClick: answer },
  ],
  deny: { label: "Deny", onClick: answer },
  signedIn: "Signed in as robin@example.com",
} satisfies ConsentScreenProps;

const french = {
  brandLabel: "Gousset",
  title: "Autoriser Claude Code à accéder à votre Gousset ?",
  origin: "Il vient de claude.example.com et sera renvoyé vers 127.0.0.1:53682.",
  readsTitle: "Il lira",
  reads: [
    { icon: "accounts", label: "Vos comptes et leurs soldes" },
    { icon: "operations", label: "Vos lignes et vos imports" },
    { icon: "review", label: "Vos mois et leur bilan" },
  ],
  write: {
    title: "Il demande aussi à écrire",
    summary: "Avec l'écriture, il peut modifier vos données comme vous",
    detail:
      "Ajouter ou modifier un compte, importer un relevé, annuler un import, noter un solde. Autorisez la lecture seule, sauf si vous voulez qu'il agisse pour vous.",
  },
  revoke:
    "Vous pouvez le révoquer à tout moment dans Réglages › Général › Clients connectés. La révocation le coupe aussitôt.",
  allow: [
    { label: "Autoriser la lecture seule", recommended: "Recommandé", onClick: answer },
    { label: "Autoriser la lecture et l'écriture", onClick: answer },
  ],
  deny: { label: "Refuser", onClick: answer },
  signedIn: "Connecté en tant que robin@example.com",
} satisfies ConsentScreenProps;

/**
 * The screen an MCP client's authorization stops at: the task itself, never a dialog. Who asks and
 * where it goes back to, then its parts under small headings: what it will read, what write would
 * allow (only when asked), how to revoke it. The choices that allow are stacked at full width, read
 * only first as the primary and recommended one; "Deny" sits apart under a rule, quiet, beside who
 * is signed in. On a desktop, a card as tall as its content under the brand; on a phone, the page
 * is the screen and the choices stay at the bottom.
 *
 * Motion: none of its own. The pressed choice shows the button's loader after 300 ms and keeps its
 * width, the others are disabled meanwhile; the loader pulses under reduced motion.
 *
 * Don't: put the choices side by side (they wrap), make "Deny" red (refusing is safe) or the
 * default, or make read and write the primary choice.
 */
const meta = {
  title: "Layout/Consent screen",
  component: ConsentScreen,
  parameters: { layout: "fullscreen" },
  args: english,
} satisfies Meta<typeof ConsentScreen>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The client asks to read and to write. */
export const ReadAndWrite: Story = {};

/** The client asks only to read: one choice, and no part about write. */
export const ReadOnly: Story = {
  args: {
    write: undefined,
    allow: [{ label: "Allow", onClick: answer }],
  },
};

/** An answer on its way: the pressed choice is busy, the others disabled. */
export const Answering: Story = {
  args: {
    busy: true,
    allow: [
      { label: "Allow read only", recommended: "Recommended", loading: true, onClick: answer },
      { label: "Allow read and write", onClick: answer },
    ],
  },
};

/** The answer failed: the error sits above the choices. */
export const Failed: Story = {
  args: { error: "Something went wrong. Try again." },
};

/** In French, whose labels are the longest. */
export const French: Story = { args: french };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

export const PhoneFrench: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: french,
};
