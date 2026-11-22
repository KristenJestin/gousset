import type { Meta, StoryObj } from "@storybook/react-vite";

import { Icon } from "./icon";
import { CATEGORY_ICON_NAMES, INTERFACE_ICON_NAMES } from "./icons";
import type { IconName } from "./icons";

function Gallery({ names }: { names: ReadonlyArray<IconName> }) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
      {names.map((name) => (
        <li key={name} className="flex flex-col items-center gap-2 rounded-lg border bg-card p-3">
          <Icon name={name} size="lg" />
          <code className="text-xs text-muted-foreground">{name}</code>
        </li>
      ))}
    </ul>
  );
}

/**
 * Gousset's icons: Tabler, outline, stroke 1.5, behind one wrapper. Every icon the app uses is
 * named in `icons.ts` after what it means (`import`, `transfer`, `groceries`), and drawn with
 * `<Icon name="import" />`. It takes the colour of its text.
 *
 * Motion: none of its own.
 *
 * Don't: import `@tabler/icons-react` in a page (lint refuses it), size an icon with a class of
 * the page, or use an emoji for a category. A missing icon is added to `icons.ts`.
 */
const meta = {
  title: "Foundations/Icon",
  component: Icon,
  args: { name: "import" },
} satisfies Meta<typeof Icon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Four sizes: `sm` 14 px, `md` 16 px beside text, `lg` 20 px, `xl` 24 px. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4 text-foreground">
      <Icon name="import" size="sm" />
      <Icon name="import" size="md" />
      <Icon name="import" size="lg" />
      <Icon name="import" size="xl" />
    </div>
  ),
};

/** With a label it is announced (`role="img"`); without, it is decoration. */
export const Labelled: Story = { args: { name: "warning", label: "Over the benchmark" } };

/** It takes `currentColor`: here the money roles. */
export const Coloured: Story = {
  render: () => (
    <div className="flex gap-4">
      <span className="text-money-spent">
        <Icon name="groceries" size="lg" />
      </span>
      <span className="text-money-saved">
        <Icon name="savings" size="lg" />
      </span>
      <span className="text-money-income">
        <Icon name="up" size="lg" />
      </span>
      <span className="text-destructive">
        <Icon name="error" size="lg" />
      </span>
    </div>
  ),
};

export const InterfaceIcons: Story = {
  render: () => <Gallery names={INTERFACE_ICON_NAMES} />,
};

/** The icons a category can choose from, in the order they are offered. */
export const CategoryIcons: Story = {
  render: () => <Gallery names={CATEGORY_ICON_NAMES} />,
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Gallery names={CATEGORY_ICON_NAMES} />,
};
