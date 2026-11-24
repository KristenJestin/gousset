import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

import { buttonClasses } from "../lib/button-classes";
import type { ButtonSize, ButtonVariant } from "../lib/button-classes";
import { Icon } from "./icon";
import type { IconName } from "./icon";

export type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & {
  ref?: Ref<HTMLAnchorElement>;
  children: ReactNode;
  /** `primary` for the next step of a task ("Continue to the review"). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon after the label: where the link leads ("next"). */
  trailingIcon?: IconName;
};

/**
 * A link that looks like a button: the next step of a task, which goes to another page rather
 * than acting here (an import's "Continue to the review"). The app turns it into a router link
 * with TanStack Router's `createLink`. A link inside text stays a `TextLink`.
 *
 * Motion: as `Button`, colours change in 150 ms on hover and it presses in slightly (scale 0.97);
 * cut under reduced motion.
 */
export function ButtonLink({
  ref,
  children,
  variant = "primary",
  size = "md",
  trailingIcon,
  ...props
}: ButtonLinkProps) {
  return (
    <a ref={ref} {...props} className={buttonClasses(variant, size)}>
      {children}
      {trailingIcon === undefined ? null : (
        <Icon name={trailingIcon} size={size === "sm" ? "sm" : "md"} />
      )}
    </a>
  );
}
