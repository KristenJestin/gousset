import type { Meta, StoryObj } from "@storybook/react-vite";

import { Brand } from "./brand";

/**
 * Gousset's mark at the top of the sidebar, with its wordmark when the sidebar is wide. The G
 * takes the accent and the coin the text's colour: check both colour schemes. Don't redraw the
 * brand elsewhere, nor recolour it.
 */
const meta = {
  title: "Brand/Brand",
  component: Brand,
  args: { label: "Gousset" },
} satisfies Meta<typeof Brand>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Mark: Story = {};

export const WithWordmark: Story = { args: { wordmark: true } };
