import { domAnimation, domMax, LazyMotion, m } from "motion/react";
import { useState, useSyncExternalStore } from "react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { transition } from "../lib/motion";
import { Brand } from "./brand";
import { Icon } from "./icon";
import type { IconName } from "./icon";

// The app's frame (docs/wireframes, every screen; `mobile` for the phone). From 768 px a sidebar:
// narrow (icons) up to 1024 px, then wide (labels, the wordmark beside the mark). Below 768 px a
// tab bar at the bottom. The links are plain anchors here; the app makes them router links with
// TanStack Router's `createLink`, which marks the current one `aria-current="page"`.

export type AppShellProps = {
  /** The app's name, from the messages: the brand's accessible name. */
  brandLabel: string;
  /** The main navigation's accessible name. */
  navigationLabel: string;
  /** `NavLink`s, one per screen. */
  navigation: ReactNode;
  /** At the sidebar's foot: the settings' `NavLink` and the user's menu. */
  footer: ReactNode;
  /** The phone's tab bar: `TabLink`s and the "More" menu. */
  tabBar: ReactNode;
  /** The screen: a `Page`, inside a `ScreenTransition`. */
  children: ReactNode;
};

export function AppShell({
  brandLabel,
  navigationLabel,
  navigation,
  footer,
  tabBar,
  children,
}: AppShellProps) {
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 hidden h-svh w-16 shrink-0 flex-col gap-6 border-r bg-sidebar p-3 text-sidebar-foreground md:flex lg:w-56">
        <div className="flex h-9 items-center px-1">
          <span className="lg:hidden">
            <Brand label={brandLabel} />
          </span>
          <span className="hidden lg:block">
            <Brand label={brandLabel} wordmark />
          </span>
        </div>
        <nav aria-label={navigationLabel} className="flex flex-1 flex-col gap-1">
          {navigation}
        </nav>
        <div className="flex flex-col gap-1">{footer}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">{children}</div>
      <nav
        aria-label={navigationLabel}
        className="fixed inset-x-0 bottom-0 z-10 flex h-16 items-stretch justify-around border-t bg-sidebar px-2 md:hidden"
      >
        {tabBar}
      </nav>
    </div>
  );
}

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> & {
  ref?: Ref<HTMLAnchorElement>;
};

export type NavLinkProps = AnchorProps & {
  icon: IconName;
  label: string;
};

/**
 * A screen in the sidebar: its icon, and its label once the sidebar is wide (said to screen
 * readers always). The current screen's background is one element that slides from the item left
 * to the item reached (Motion's shared layout, 200 ms, ease-out); cut under reduced motion.
 */
export function NavLink({ icon, label, ...props }: NavLinkProps) {
  const current = props["aria-current"] === "page";

  return (
    <a
      {...props}
      className="relative isolate flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
    >
      {current ? <CurrentMark layoutId="nav-current" place="nav" /> : null}
      <Icon name={icon} size="lg" />
      <span className="sr-only lg:not-sr-only">{label}</span>
    </a>
  );
}

const subscribeToNothing = () => () => undefined;

/**
 * The current item's mark, which slides to the item reached (Motion's shared layout). On the
 * server and while hydrating it is a plain element: Motion writes a `style` attribute, which the
 * Content Security Policy refuses in the server's markup.
 *
 * It is drawn under its link's content whatever that content's position: the link isolates its
 * layers, and the mark sits below them. A positioned mark is otherwise painted over the content
 * that is not positioned, as the wide sidebar's label is (`lg:not-sr-only` makes it static).
 */
function CurrentMark({ layoutId, place }: { layoutId: string; place: "nav" | "tab" }) {
  const inBrowser = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const className =
    place === "nav"
      ? "absolute inset-0 -z-10 rounded-md bg-muted"
      : "absolute inset-x-4 top-0 -z-10 h-0.5 rounded-full bg-primary";

  if (!inBrowser) {
    return <span data-slot="current-mark" className={className} />;
  }

  // A shared layout needs layout projection: `domMax`, not `domAnimation`.
  return (
    <LazyMotion features={domMax}>
      <m.span
        data-slot="current-mark"
        layoutId={layoutId}
        transition={transition.base}
        className={className}
      />
    </LazyMotion>
  );
}

type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "children" | "type"
> & { ref?: Ref<HTMLButtonElement> };

export type NavButtonProps = ButtonProps & {
  icon: IconName;
  label: string;
};

/** A button that sits among the sidebar's links, like the user's menu's trigger. */
export function NavButton({ icon, label, ...props }: NavButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className="flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
    >
      <Icon name={icon} size="lg" />
      <span className="sr-only truncate lg:not-sr-only">{label}</span>
    </button>
  );
}

/**
 * A screen in the phone's tab bar: its icon above its label. The current one's mark slides to the
 * tab reached, as in the sidebar.
 */
export function TabLink({ icon, label, ...props }: NavLinkProps) {
  const current = props["aria-current"] === "page";

  return (
    <a
      {...props}
      className="relative isolate flex flex-1 flex-col items-center justify-center gap-1 text-xs text-muted-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
    >
      {current ? <CurrentMark layoutId="tab-current" place="tab" /> : null}
      <Icon name={icon} size="lg" />
      <span>{label}</span>
    </a>
  );
}

/** The tab bar's last place: a button opening the menu of the other screens. */
export function TabButton({ icon, label, ...props }: NavButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className="relative flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 text-xs text-muted-foreground data-popup-open:text-foreground"
    >
      <Icon name={icon} size="lg" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Moving between screens is one transition: the screen reached fades in (200 ms, ease-out), the
 * frame staying in place. The first screen of a visit shows at once, as the server drew it. `id`
 * names the screen (its path); a change inside a screen (its month) does not fade it. Cut under
 * reduced motion.
 */
export function ScreenTransition({ id, children }: { id: string; children: ReactNode }) {
  const [first, setFirst] = useState<string | null>(id);

  if (first !== null && first !== id) {
    setFirst(null);
  }

  // The first screen is a plain element: Motion would write `style="opacity:1"` into the server's
  // markup, which the Content Security Policy refuses.
  if (first === id) {
    return (
      <div data-slot="screen" className="flex min-w-0 flex-1 flex-col">
        {children}
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        key={id}
        data-slot="screen"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transition.base}
        className="flex min-w-0 flex-1 flex-col"
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}

export type PageProps = {
  /** The screen's name: its only `h1`. */
  title: string;
  /** A sentence under the title, about the whole screen ("Made-up data…"). */
  description?: string;
  /** Beside the title: the month switcher of a month's screen, a screen's main action. */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * A screen of the app: its title and the sentence under it, what sits beside them, then its
 * blocks one under the other.
 */
export function Page({ title, description, actions, children }: PageProps) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-8">
      <header className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{title}</h1>
          {description === undefined ? null : (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

export type SectionLayoutProps = {
  /** The sections' navigation's accessible name ("Settings"). */
  label: string;
  /** `SectionLink`s, one per section. */
  navigation: ReactNode;
  children: ReactNode;
};

/**
 * A screen in sections, like the settings: their links in a column beside the section shown, or
 * in a row above it on a phone.
 */
export function SectionLayout({ label, navigation, children }: SectionLayoutProps) {
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav
        aria-label={label}
        className="flex shrink-0 gap-1 overflow-x-auto md:w-44 md:flex-col md:overflow-visible"
      >
        {navigation}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </div>
  );
}

/** A section's link: the current one stands out (`aria-current="page"`, set by the router). */
export function SectionLink({ label, ...props }: AnchorProps & { label: string }) {
  return (
    <a
      {...props}
      className="flex h-8 items-center rounded-md px-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground"
    >
      {label}
    </a>
  );
}

/** A block of a screen under its own heading: a group of settings, say. */
export function Block({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-5 text-card-foreground">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description === undefined ? null : (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * A screen with nothing to show yet, in one block: what will fill it. It fades in (200 ms,
 * ease-out), drawn by CSS so the server's first paint fades in too; cut under reduced motion.
 */
export function ScreenBlock({ children }: { children: ReactNode }) {
  return (
    <section
      data-slot="screen-block"
      className="rounded-lg border bg-card text-card-foreground duration-200 ease-out animate-in fade-in"
    >
      {children}
    </section>
  );
}
