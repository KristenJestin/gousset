import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { Card } from "./card";
import { FormMessage } from "./form-message";
import { Actions, Form, Screen } from "./screen";
import { TextField } from "./text-field";
import { TextLink } from "./text-link";

/**
 * A screen with one narrow column: signing in, the first setup, changing a password. `Form` lays
 * out fields and actions, `Actions` a row of buttons or links. Not for the app's main pages,
 * which have their frame.
 */
const meta = {
  title: "Layout/Screen",
  component: Screen,
  parameters: { layout: "fullscreen" },
  args: { children: null },
} satisfies Meta<typeof Screen>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SignIn: Story = {
  render: () => (
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
  ),
};
