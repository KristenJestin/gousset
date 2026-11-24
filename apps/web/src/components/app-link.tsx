import { AccountRow } from "@gousset/ui/components/accounts-overview";
import { NavLink, SectionLink, TabLink } from "@gousset/ui/components/app-shell";
import { ButtonLink } from "@gousset/ui/components/button-link";
import { ReviewComingLink } from "@gousset/ui/components/review-coming";
import { TextLink } from "@gousset/ui/components/text-link";
import { createLink } from "@tanstack/react-router";

// `packages/ui`'s links, navigating inside the app without a reload. The router marks the current
// one `aria-current="page"`, which the frame's links read.

export const AppLink = createLink(TextLink);

/** A link that looks like a button: the next step of a task, on another page. */
export const AppButtonLink = createLink(ButtonLink);

export const AppNavLink = createLink(NavLink);

export const AppTabLink = createLink(TabLink);

export const AppSectionLink = createLink(SectionLink);

/** One row of the accounts overview, a router link to its page. */
export const AccountRowLink = createLink(AccountRow);

/** One row of the review's empty state, a router link to a screen that works today. */
export const AppReviewComingLink = createLink(ReviewComingLink);
