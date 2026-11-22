import type { AnchorHTMLAttributes, Ref } from "react";

/**
 * A link inside text or a row of actions. The app turns it into a router link with TanStack
 * Router's `createLink`, so that it navigates without reloading the page.
 */
export function TextLink({
  ref,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & { ref?: Ref<HTMLAnchorElement> }) {
  return (
    <a
      ref={ref}
      {...props}
      className="text-foreground focus-visible:ring-ring rounded-sm text-sm font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2"
    />
  );
}
