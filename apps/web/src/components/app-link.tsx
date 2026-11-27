import { AccountRow } from "@gousset/ui/components/accounts-overview";
import { NavLink, SectionLink, TabLink } from "@gousset/ui/components/app-shell";
import { ButtonLink } from "@gousset/ui/components/button-link";
import { ListLinkItem } from "@gousset/ui/components/list";
import { SubjectTreeItem } from "@gousset/ui/components/subject-tree";
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

/** One row of a `List` that opens what it names, a router link to its page. */
export const ListRowLink = createLink(ListLinkItem);

/** One row of the accounts overview, a router link to its page. */
export const AccountRowLink = createLink(AccountRow);

/** One subject of the subjects' tree, a router link to its page. */
export const SubjectTreeLink = createLink(SubjectTreeItem);
