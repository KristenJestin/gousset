import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { MERCHANTS } from "../stories/made-up";
import { MerchantLogo } from "./merchant-logo";

// A made-up logo, drawn here: no image of a real brand, no request to anyone.
const MADE_UP_LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#2f6b4f"/><path d="M12 26c4-10 12-10 16 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
)}`;

/**
 * A merchant's logo beside its name. Without a logo, or when it fails to load, its initials on a
 * tile whose tone comes from the name (a hash, never random, theme tokens only): the same
 * merchant keeps the same tile everywhere. Decorative (`alt=""`): the name sits beside it. The
 * image loads lazily. Sizes match `CategoryIcon` (24, 32, 40 px).
 *
 * Motion: none; it does not move.
 *
 * Don't: show it without the merchant's name beside it, fetch logos from a third party in the
 * browser, or pick its colour by hand.
 */
const meta = {
  title: "Data/MerchantLogo",
  component: MerchantLogo,
  args: { name: "Corner Bistro" },
} satisfies Meta<typeof MerchantLogo>;

export default meta;

type Story = StoryObj<typeof meta>;

/** No logo: the initials. */
export const Initials: Story = {};

export const WithLogo: Story = { args: { name: "Greenmarket", src: MADE_UP_LOGO } };

/** The logo's address answers nothing: the initials take its place. */
export const BrokenLogo: Story = { args: { name: "Fuelstop", src: "/made-up-logos/fuelstop.png" } };

const BROKEN = "/made-up-logos/fuelstop.png";

/**
 * As a page rendered on the server meets it: the markup arrives, its image fails, and only then
 * does React hydrate it, too late to hear the error.
 */
function HydratedAfterTheFailure() {
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = host.current;

    if (element === null) {
      return;
    }

    const logo = <MerchantLogo name="Fuelstop" src={BROKEN} />;

    element.innerHTML = renderToString(logo);

    const image = element.querySelector("img");
    let root: ReturnType<typeof hydrateRoot> | undefined;

    const hydrate = () => {
      root = hydrateRoot(element, logo);
    };

    if (image === null || image.complete) {
      hydrate();
    } else {
      image.addEventListener("error", hydrate, { once: true });
      image.addEventListener("load", hydrate, { once: true });
    }

    return () => root?.unmount();
  }, []);

  return <span ref={host} data-testid="hydrated-after-failure" />;
}

/** The logo failed before the page hydrated: the initials still take its place. */
export const BrokenBeforeHydration: Story = { render: () => <HydratedAfterTheFailure /> };

export const Round: Story = { args: { corners: "round" } };

/** 24, 32 and 40 px, with and without a logo. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {(["sm", "md", "lg"] as const).map((size) => (
        <MerchantLogo key={size} name="Streamly" size={size} />
      ))}
      {(["sm", "md", "lg"] as const).map((size) => (
        <MerchantLogo key={`logo-${size}`} name="Greenmarket" src={MADE_UP_LOGO} size={size} />
      ))}
    </div>
  ),
};

/** Each merchant keeps its own tone, from its name. */
export const InRows: Story = {
  render: () => (
    <ul className="flex max-w-xs flex-col gap-2">
      {MERCHANTS.map((merchant) => (
        <li key={merchant.id} className="flex items-center gap-3 text-sm">
          <MerchantLogo name={merchant.name} size="sm" />
          {merchant.name}
        </li>
      ))}
    </ul>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => (
    <ul className="flex flex-col gap-2">
      {MERCHANTS.map((merchant) => (
        <li key={merchant.id} className="flex items-center gap-3 text-sm">
          <MerchantLogo name={merchant.name} />
          {merchant.name}
        </li>
      ))}
    </ul>
  ),
};
