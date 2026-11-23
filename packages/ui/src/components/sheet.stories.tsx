import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { MERCHANTS } from "../stories/made-up";
import { Button } from "./button";
import { Sheet } from "./sheet";
import { TextField } from "./text-field";

function Filters() {
  return (
    <Sheet
      trigger={<Button variant="secondary">Filters</Button>}
      title="Filters"
      description="Show only the lines of these merchants."
      actions={<Button>Show the lines</Button>}
    >
      <ul className="flex flex-col gap-2">
        {MERCHANTS.map((merchant) => (
          <li key={merchant.id}>{merchant.name}</li>
        ))}
      </ul>
    </Sheet>
  );
}

/**
 * A long form in a sheet, as a page holds an action with many fields: it stays open while a
 * refusal shows under its field, and closes once the form is accepted.
 */
function NewAccount() {
  const [open, setOpen] = useState(false);
  const [refused, setRefused] = useState(false);
  const [created, setCreated] = useState(false);

  return (
    <div className="flex flex-col items-start gap-3">
      <Sheet
        trigger={<Button icon="add">New account</Button>}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setRefused(false);
        }}
        title="New account"
        description="Where money is kept: a current account, a card, savings."
        onSubmit={(event) => {
          event.preventDefault();

          if (new FormData(event.currentTarget).get("name") === "") {
            setRefused(true);

            return;
          }

          setCreated(true);
          setOpen(false);
        }}
        onInput={() => setRefused(false)}
        actions={<Button type="submit">Create the account</Button>}
      >
        <TextField
          label="Name"
          name="name"
          error={refused ? "Give the account a name." : undefined}
        />
        <TextField label="Institution" name="institution" defaultValue="Example Bank" />
        <TextField label="Currency" name="currency" defaultValue="EUR" />
        <TextField label="Opening balance" name="opening" defaultValue="0.00" />
      </Sheet>
      <p className="text-sm text-muted-foreground">{created ? "Created" : "Nothing created"}</p>
    </div>
  );
}

/**
 * A panel over the page, on ui-sdk's `Drawer`: from the right on a wide screen (from 768 px), from
 * the bottom on a phone, where it can be dragged down to close. For a line's detail, the filters,
 * or a long form (`onSubmit`: the body and actions are one form, Cancel comes first, and the page
 * closes it once the form is accepted; docs/design.md, "Actions and forms"). Modal: focus stays
 * inside; Escape, the close button, a press outside or a swipe closes it, and focus returns to what
 * opened it.
 *
 * Motion: it slides in from its edge with ui-sdk's short spring (about 300 ms) while the page
 * behind veils; under reduced motion it fades instead of sliding.
 *
 * Don't: stack a sheet on a sheet, use it for a question to answer (that is an `AlertDialog`) or
 * for a short form (that is a `Dialog`), or put the page's main content in it.
 */
const meta = {
  title: "Overlays/Sheet",
  component: Filters,
} satisfies Meta<typeof Filters>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** On a phone, it rises from the bottom. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

/** A long form: Cancel, then the submit button; an empty name is refused under its field. */
export const WithForm: Story = { render: () => <NewAccount /> };
