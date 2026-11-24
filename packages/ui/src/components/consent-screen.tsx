import { useId } from "react";
import type { ReactNode } from "react";

import { Brand } from "./brand";
import { Button } from "./button";
import { FormMessage } from "./form-message";
import { Icon } from "./icon";
import type { IconName } from "./icon";

export type ConsentChoice = {
  label: string;
  /** Said beside the label of the choice to prefer ("Recommended"), when there are several. */
  recommended?: string;
  /** The choice pressed, while its answer is sent: its loader shows, the others are disabled. */
  loading?: boolean;
  onClick: () => void;
};

export type ConsentRead = { icon: IconName; label: string };

export type ConsentWrite = {
  /** The part's heading ("It also asks to write"). */
  title: string;
  /** What write allows, in one line. */
  summary: string;
  /** What it could do, and the advice to allow read only. */
  detail: string;
};

export type ConsentScreenProps = {
  /** The app's name, for the brand above the screen. */
  brandLabel: string;
  /** Who asks: "Allow Claude Code to reach your Gousset?". */
  title: string;
  /** Where it comes from and where the browser goes back to, as the user should check it. */
  origin?: string;
  /** The heading of what it will read ("It will read"). */
  readsTitle: string;
  reads: ReadonlyArray<ConsentRead>;
  /** Only when write is asked: what write allows. */
  write?: ConsentWrite;
  /** How to revoke it later. */
  revoke: string;
  /** The answer failed. */
  error?: string;
  /** An answer is being sent: every choice is disabled but the one pressed. */
  busy?: boolean;
  /** The choices that allow, stacked: the first is the primary one, the safer. */
  allow: ReadonlyArray<ConsentChoice>;
  /** Refusing, apart from the choices that allow. */
  deny: ConsentChoice;
  /** Who is signed in ("Signed in as robin@example.com"). */
  signedIn?: string;
};

/**
 * The screen an MCP client's authorization stops at (docs/mcp.md, "Authorization and scopes"):
 * the task itself, not a dialog over a page. One column: who asks, then its parts (what it will
 * read, what write would allow, how to revoke it), then the choices that allow, stacked at full
 * width so that no label wraps, and "Deny" apart under a rule, quiet, never the default.
 *
 * On a desktop it is a card as tall as its content, centred under the brand. On a phone the page
 * is the screen: no card, and the choices stay at the bottom, in the thumb's reach.
 *
 * Motion: none of its own. The pressed choice shows the button's loader after 300 ms and keeps its
 * width; the others are disabled meanwhile. Under reduced motion the loader pulses instead.
 */
export function ConsentScreen({
  brandLabel,
  title,
  origin,
  readsTitle,
  reads,
  write,
  revoke,
  error,
  busy = false,
  allow,
  deny,
  signedIn,
}: ConsentScreenProps) {
  const titleId = useId();

  return (
    <main className="bg-background flex min-h-svh flex-col items-center md:justify-center md:gap-6 md:p-6">
      <div className="flex w-full px-5 pt-6 md:w-auto md:p-0">
        <Brand label={brandLabel} wordmark />
      </div>
      <section
        aria-labelledby={titleId}
        className="flex w-full flex-1 flex-col md:max-w-md md:flex-none md:rounded-lg md:border md:bg-card md:text-card-foreground"
      >
        <div className="flex flex-1 flex-col gap-6 px-5 py-6 md:px-8 md:pt-8">
          <header className="flex flex-col items-start gap-4">
            <span className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-md">
              <Icon name="agent" size="lg" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              {/* The name is the client's own words: clamped, so that a long one can never push
                  where it really comes from out of sight above the pinned choices. */}
              <h1 id={titleId} className="line-clamp-3 text-base font-semibold break-words">
                {title}
              </h1>
              {origin === undefined ? null : (
                <p className="text-muted-foreground text-sm break-words">{origin}</p>
              )}
            </div>
          </header>
          <div className="flex flex-col divide-y">
            <Part title={readsTitle}>
              <ul className="flex flex-col gap-3">
                {reads.map((read) => (
                  <li key={read.label} className="flex items-start gap-3 text-sm font-medium">
                    <span className="text-muted-foreground flex pt-0.5">
                      <Icon name={read.icon} />
                    </span>
                    {read.label}
                  </li>
                ))}
              </ul>
            </Part>
            {write === undefined ? null : (
              <Part title={write.title}>
                <div className="bg-warning/10 flex items-start gap-3 rounded-md p-3 text-sm">
                  <span className="text-warning flex pt-0.5">
                    <Icon name="edit" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="font-medium">{write.summary}</p>
                    <p className="text-muted-foreground">{write.detail}</p>
                  </div>
                </div>
              </Part>
            )}
            <div className="text-muted-foreground flex items-start gap-3 pt-5 text-sm">
              <span className="flex pt-0.5">
                <Icon name="password" />
              </span>
              <p className="min-w-0">{revoke}</p>
            </div>
          </div>
        </div>
        <div className="bg-card sticky bottom-0 flex flex-col gap-4 border-t px-5 pt-4 pb-6 md:static md:border-t-0 md:bg-transparent md:px-8 md:pt-0 md:pb-8">
          <div className="@container flex flex-col gap-2">
            {allow.map((choice, index) => (
              <Button
                key={choice.label}
                variant={index === 0 ? "primary" : "secondary"}
                loading={choice.loading === true}
                disabled={busy && choice.loading !== true}
                onClick={() => choice.onClick()}
              >
                {choice.label}
                {/* The space keeps the name read apart: "Allow read only Recommended". */}
                {choice.recommended === undefined ? null : " "}
                {choice.recommended === undefined ? null : (
                  <span className="bg-primary-foreground/20 ml-1 hidden rounded-full px-2 text-xs font-medium @xs:inline">
                    {choice.recommended}
                  </span>
                )}
              </Button>
            ))}
            {/* Under the choice just pressed; its line is always there, so nothing jumps. */}
            <FormMessage message={error} />
          </div>
          <div className="flex items-center justify-between gap-3 md:border-t md:pt-4">
            <p className="text-muted-foreground min-w-0 truncate text-xs">{signedIn}</p>
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              loading={deny.loading === true}
              disabled={busy && deny.loading !== true}
              onClick={() => deny.onClick()}
            >
              {deny.label}
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

/** One part of the text, under its small heading; a rule sets it apart from the next. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-5 first:pt-0">
      <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      {children}
    </div>
  );
}
