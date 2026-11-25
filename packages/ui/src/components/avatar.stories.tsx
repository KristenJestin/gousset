import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { PALETTE_COLORS } from "../lib/palette";
import { MERCHANTS } from "../stories/made-up";
import { Avatar } from "./avatar";

// A made-up logo, drawn here: no image of a real brand, no request to anyone.
const MADE_UP_LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#2f6b4f"/><path d="M12 26c4-10 12-10 16 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
)}`;

const BROKEN = "/made-up-logos/fuelstop.png";

/**
 * A logo beside a name (a merchant's; a bank's, later). Without a logo, or when it fails to load,
 * the name's initials on a colour of the palette: the one the user picked, else the name's
 * automatic one (a hash, never random), so the same name keeps the same tile everywhere. Every
 * colour keeps its initials at 4.5:1 or more in light and in dark (`contrast.test.ts`, the
 * "Theme/Tokens" story). Decorative (`aria-hidden`, `alt=""`): the name sits beside it. The image
 * loads lazily. Sizes match `CategoryIcon` (24, 32, 40 px).
 *
 * Motion: none of its own; it does not move.
 *
 * Don't: show it without the name beside it, fetch a logo from a third party in the browser,
 * or colour it with anything but a palette key.
 */
const meta = {
  title: "Data/Avatar",
  component: Avatar,
  args: { name: "Corner Bistro" },
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** No logo, no colour picked: the initials on the name's automatic colour. */
export const Initials: Story = {};

/** A colour the user picked, in place of the automatic one. */
export const PickedColor: Story = { args: { color: "violet" } };

export const WithLogo: Story = { args: { name: "Greenmarket", src: MADE_UP_LOGO } };

/** The logo's address answers nothing: the initials take its place. */
export const BrokenLogo: Story = { args: { name: "Fuelstop", src: BROKEN } };

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

    const avatar = <Avatar name="Fuelstop" src={BROKEN} />;

    element.innerHTML = renderToString(avatar);

    const image = element.querySelector("img");
    let root: ReturnType<typeof hydrateRoot> | undefined;

    const hydrate = () => {
      root = hydrateRoot(element, avatar);
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
        <Avatar key={size} name="Streamly" size={size} />
      ))}
      {(["sm", "md", "lg"] as const).map((size) => (
        <Avatar key={`logo-${size}`} name="Greenmarket" src={MADE_UP_LOGO} size={size} />
      ))}
    </div>
  ),
};

/** Every colour of the palette, in the order it is offered. */
export const Palette: Story = {
  render: () => (
    <ul className="grid max-w-md grid-cols-4 gap-3 sm:grid-cols-6">
      {PALETTE_COLORS.map((color) => (
        <li key={color} className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
          <Avatar name="Corner Bistro" color={color} size="lg" />
          {color}
        </li>
      ))}
    </ul>
  ),
};

/** Each name keeps its own colour, from its name. */
export const InRows: Story = {
  render: () => (
    <ul className="flex max-w-xs flex-col gap-2">
      {MERCHANTS.map((merchant) => (
        <li key={merchant.id} className="flex items-center gap-3 text-sm">
          <Avatar name={merchant.name} size="sm" />
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
          <Avatar name={merchant.name} />
          {merchant.name}
        </li>
      ))}
    </ul>
  ),
};
