import { NavLink, SectionLink, TabLink } from "@gousset/ui/components/app-shell";
import { TextLink } from "@gousset/ui/components/text-link";
import { createLink } from "@tanstack/react-router";

// `packages/ui`'s links, navigating inside the app without a reload. The router marks the current
// one `aria-current="page"`, which the frame's links read.

export const AppLink = createLink(TextLink);

export const AppNavLink = createLink(NavLink);

export const AppTabLink = createLink(TabLink);

export const AppSectionLink = createLink(SectionLink);
