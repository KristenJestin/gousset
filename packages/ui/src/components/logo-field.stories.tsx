import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { LogoField } from "./logo-field";
import type { LogoFieldProps } from "./logo-field";

// A made-up logo, drawn here: no image of a real brand, no request to anyone.
const MADE_UP_LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#2f6b4f"/><path d="M12 26c4-10 12-10 16 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
)}`;

/**
 * The field as a page holds it: a file picked shows at once from its `data:` preview, Remove
 * gives the initials back, and what the field reported is written out, so a test can read it.
 */
function Holding({ props }: { props: LogoFieldProps }) {
  const [src, setSrc] = useState(props.src);
  const [reported, setReported] = useState<string>();

  return (
    <div className="flex max-w-md flex-col gap-4">
      <LogoField
        {...props}
        src={src}
        onFile={(file, preview) => {
          setSrc(preview);
          setReported(
            `${file.name}, ${preview?.startsWith("data:") === true ? "data: preview" : "no preview"}`,
          );
        }}
        onRemove={() => {
          setSrc(undefined);
          setReported("removed");
        }}
      />
      <p data-testid="reported" className="text-sm text-muted-foreground">
        {reported ?? "Nothing reported yet."}
      </p>
    </div>
  );
}

/**
 * A logo to upload for a name (a merchant's; a bank's, later): the avatar it gives at 40 px, then
 * "Choose a file", or "Replace" and "Remove" once there is one. The picker keeps to PNG, JPEG and
 * WebP. The field reports the file picked with its preview, a `data:` URL (the Content Security
 * Policy allows `data:` images, never `blob:`); the page checks it, uploads it, and says under it
 * why one was refused. Without a logo the avatar shows the name's initials on its colour.
 *
 * Motion: none of its own; the buttons' own (colours in 150 ms, a slight press), cut under
 * reduced motion.
 *
 * Don't: fetch a logo from the web, take an SVG (it can carry a script), or upload before the
 * form is saved.
 */
const meta = {
  title: "Forms/LogoField",
  component: LogoField,
  args: {
    label: "Logo",
    name: "Corner Bistro",
    description: "PNG, JPEG or WebP, 256 KiB at most.",
    onFile: () => undefined,
  },
  render: (args) => <Holding props={args} />,
} satisfies Meta<typeof LogoField>;

export default meta;

type Story = StoryObj<typeof meta>;

/** No logo yet: the initials, and "Choose a file". */
export const Default: Story = {};

/** A logo: "Replace" and "Remove". */
export const WithLogo: Story = { args: { name: "Greenmarket", src: MADE_UP_LOGO } };

/** The initials take the colour picked. */
export const PickedColor: Story = { args: { color: "indigo" } };

/** The file was refused: why, under the field. */
export const Refused: Story = {
  args: { error: "This file is larger than 256 KiB. Choose a smaller image." },
};

/** While the form is sent. */
export const Disabled: Story = { args: { src: MADE_UP_LOGO, disabled: true } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { src: MADE_UP_LOGO },
};

/** On a French page: the buttons in French. */
export const French: Story = {
  args: { src: MADE_UP_LOGO, description: "PNG, JPEG ou WebP, 256 Kio au plus." },
  render: (args) => (
    <InFrench>
      <Holding props={args} />
    </InFrench>
  ),
};
