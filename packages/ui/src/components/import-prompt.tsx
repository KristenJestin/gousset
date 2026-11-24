import type { ReactNode } from "react";

import { Icon } from "./icon";

export type ImportPromptProps = {
  /** What the import says under its file: its question, or why it failed. */
  message: string;
  /** `question` waits for an answer; `error` says what went wrong, with its mark. */
  tone?: "question" | "error";
  /**
   * What answers the question: a small `Select` with its label hidden, since the message is its
   * visible label (its own label still names it for screen readers).
   */
  control?: ReactNode;
  /** The buttons, the main one last: on a phone it comes first, each one full width. */
  actions?: ReactNode;
  /** Why the answer was refused, under the line; announced, and faded in. */
  error?: string;
};

/**
 * What an import asks before it goes on, or why it failed, under its file's row on the import
 * screen: the message, the control that answers and the buttons on one inset line on a wide
 * screen, aligned and with no gap left under them; stacked on a phone, the main button first. It
 * draws its own inset; the page puts it under the row (`ImportFiles`' content), inside its form.
 *
 * The refusal's alert is always in the page, empty until a refusal comes, so that screen readers
 * announce it; it takes no line until then, so that no empty band sits under the question.
 *
 * Motion: it unfolds with the row's content (250 ms); a refusal fades in under the line in
 * 200 ms, as `FormMessage`'s does. Cut under reduced motion: it appears.
 */
export function ImportPrompt({
  message,
  tone = "question",
  control,
  actions,
  error,
}: ImportPromptProps) {
  return (
    <div
      data-slot="import-prompt"
      data-tone={tone}
      className="flex flex-col rounded-md bg-muted/70 p-3 md:py-2 md:pr-2 md:pl-3"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <p className="flex min-w-0 grow items-start gap-2 text-sm text-foreground">
          {tone === "error" ? (
            <span className="flex h-5 shrink-0 items-center text-destructive">
              <Icon name="error" />
            </span>
          ) : null}
          <span className="min-w-0">{message}</span>
        </p>
        {control === undefined ? null : <div className="md:w-60 md:shrink-0">{control}</div>}
        {actions === undefined ? null : (
          <div className="flex flex-col-reverse gap-2 md:shrink-0 md:flex-row md:items-center md:gap-3">
            {actions}
          </div>
        )}
      </div>
      <p role="alert" data-slot="import-prompt-error" className="text-sm text-destructive">
        {error === undefined ? null : (
          <span key={error} className="mt-2 block animate-in duration-200 ease-out fade-in">
            {error}
          </span>
        )}
      </p>
    </div>
  );
}
