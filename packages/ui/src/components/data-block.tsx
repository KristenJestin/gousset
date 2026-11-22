import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";

// A block of data on a page and the states it goes through while its data loads
// (docs/architecture.md, "Data loading and skeletons"). The skeleton, the error state and the
// amount below are the smallest stand-ins until the shared components land (#7).

/** One block of a page: a title, then its data. Never a block inside a block. */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="bg-card text-card-foreground flex w-full flex-col gap-3 rounded-lg border p-6"
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** The rows of a block. Every row has the same height, so a skeleton can take their exact place. */
export function FigureList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="flex flex-col">
      {children}
    </ul>
  );
}

/** One row: a name, a second line maybe, a figure, an action maybe. Always `h-12`. */
export function FigureRow({
  label,
  detail,
  figure,
  action,
}: {
  label: string;
  detail?: string;
  figure: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="flex h-12 items-center gap-3">
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-sm">{label}</span>
        {detail === undefined ? null : (
          <span className="text-muted-foreground truncate text-xs">{detail}</span>
        )}
      </div>
      <span className="shrink-0 text-sm font-medium">{figure}</span>
      {action}
    </li>
  );
}

/** A last row that says what the block does not show. Same height as a `FigureRow`. */
export function FigureMore({ children }: { children: ReactNode }) {
  return <li className="text-muted-foreground flex h-12 items-center text-sm">{children}</li>;
}

const subscribeToNothing = () => () => {};

/** The page's language (`<html lang>`), for the stand-ins' own texts; English on the server. */
function usePageLanguage(): "en" | "fr" {
  const language = useSyncExternalStore(
    subscribeToNothing,
    () => document.documentElement.lang,
    () => "en",
  );

  return language.startsWith("fr") ? "fr" : "en";
}

const loadingText = { en: "Loading", fr: "Chargement" };

/**
 * TODO(#7): replaced by `BreakdownSkeleton`, whose props these are. `rows` rows shaped like
 * `FigureRow`, and a last one like `FigureMore` when `more`, so that nothing moves when the data
 * arrives. It stays invisible for 150 ms, so that a fast answer never flashes it, then fades in;
 * under reduced motion it appears without the fade. Announced as loading.
 */
export function BreakdownSkeleton({ rows, more = false }: { rows: number; more?: boolean }) {
  const language = usePageLanguage();

  return (
    <div
      role="status"
      aria-label={loadingText[language]}
      aria-busy="true"
      className="animate-in fade-in fill-mode-both flex flex-col delay-150 duration-200"
    >
      {Array.from({ length: rows + (more ? 1 : 0) }, (_, row) => (
        <div key={row} aria-hidden="true" className="flex h-12 items-center">
          <div className="bg-muted h-4 w-full animate-pulse rounded-md" />
        </div>
      ))}
    </div>
  );
}

/**
 * Fades its content in when it replaces a skeleton in the browser. Content the server rendered
 * (the first visit) is shown as it is, without a fade: during hydration React reads the server's
 * value (`false`), and the state keeps the value of the first render.
 */
export function FadeIn({ children }: { children: ReactNode }) {
  const inBrowser = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const [fades] = useState(inBrowser);

  return <div className={cn(fades && "animate-in fade-in duration-200")}>{children}</div>;
}

const errorTexts = {
  en: {
    title: "This block could not be loaded",
    message: "Something went wrong on the way. The rest of the page still works.",
    retry: "Try again",
  },
  fr: {
    title: "Impossible de charger ce bloc",
    message: "Un problème est survenu en route. Le reste de la page fonctionne toujours.",
    retry: "Réessayer",
  },
};

/**
 * TODO(#7): replaced by `ErrorState`, whose props these are. A block whose data could not be read
 * says so in its place, with a way to try again; the rest of the page keeps working. Its texts
 * follow the page's language (`<html lang>`); it is shown only in the browser.
 */
export function ErrorState({
  onRetry,
  title,
  message,
}: {
  onRetry: () => void | Promise<void>;
  title?: string;
  message?: string;
}) {
  const texts = errorTexts[usePageLanguage()];

  return (
    <div className="flex flex-col items-start gap-3 py-3">
      <div role="alert" className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title ?? texts.title}</p>
        <p className="text-muted-foreground text-sm">{message ?? texts.message}</p>
      </div>
      <Button variant="secondary" onClick={() => void onRetry()}>
        {texts.retry}
      </Button>
    </div>
  );
}

const amountFormats = new Map<string, Intl.NumberFormat>();

/** One formatter per language and currency, built once. */
function amountFormat(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  const known = amountFormats.get(key);

  if (known !== undefined) {
    return known;
  }

  const format = new Intl.NumberFormat(locale, { style: "currency", currency });

  amountFormats.set(key, format);

  return format;
}

/**
 * TODO(#7): replaced by `Amount` (sign, currency, the digits rolling from one value to the next).
 * An amount in minor units, written in the reader's language, with tabular numerals.
 */
export function PlainAmount({
  minor,
  currency,
  locale,
}: {
  minor: number;
  currency: string;
  locale: string;
}) {
  const text = amountFormat(locale, currency).format(minor / 100);

  return <span className="tabular-nums">{text}</span>;
}
