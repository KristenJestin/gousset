import { TextLink } from "@gousset/ui/components/text-link";
import { createLink } from "@tanstack/react-router";

/** `packages/ui`'s link, navigating inside the app without a reload. */
export const AppLink = createLink(TextLink);
