import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { Card } from "./card";
import { FormMessage } from "./form-message";
import { Actions, Form, Screen } from "./screen";
import { TextField } from "./text-field";
import { TextLink } from "./text-link";

function SignInScreen() {
  return (
    <Screen>
      <Card title="Sign in" description="Sign in with the e-mail and password of your account.">
        <Form>
          <TextField label="E-mail" name="email" type="email" autoComplete="email" />
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
          />
          <FormMessage message="Wrong e-mail or password." />
          <Actions>
            <Button type="submit">Sign in</Button>
            <TextLink href="#">Back</TextLink>
          </Actions>
        </Form>
      </Card>
    </Screen>
  );
}

/**
 * A screen with one narrow column: signing in, the first setup, changing a password. `Form` lays
 * out fields and actions, `Actions` a row of buttons or links. The screen is the background; the
 * cards in its column are the blocks.
 *
 * Motion: none of its own.
 *
 * Don't: use it for the app's main pages, which have their frame, or wrap its column in a card
 * of its own (no block in a block).
 */
const meta = {
  title: "Layout/Screen",
  component: Screen,
  parameters: { layout: "fullscreen" },
  args: { children: null },
} satisfies Meta<typeof Screen>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SignIn: Story = { render: () => <SignInScreen /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <SignInScreen />,
};
