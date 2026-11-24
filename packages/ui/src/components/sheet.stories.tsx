import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { MERCHANTS } from "../stories/made-up";
import { Button } from "./button";
import { Sheet } from "./sheet";
import { TextField } from "./text-field";

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

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
 * refusal shows under its field, stays open while it is sent (a second and a half here), and
 * closes once the form is accepted.
 */
function NewAccount() {
  const [open, setOpen] = useState(false);
  const [refused, setRefused] = useState(false);
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState(false);

  async function send() {
    setSending(true);
    await wait(1500);
    setSending(false);
    setCreated(true);
    setOpen(false);
  }

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

          void send();
        }}
        onInput={() => setRefused(false)}
        sending={sending}
        actions={
          <Button type="submit" loading={sending}>
            Create the account
          </Button>
        }
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
 * A panel over the page, on ui-sdk's `Dialog`: from the right on a wide screen (from 768 px), from
 * the bottom on a phone. For a line's detail, the filters, or a long form (`onSubmit`: the body and
 * actions are one form, Cancel comes first, focus starts on the first field, and the page closes
 * it once the form is accepted; docs/design.md, "Actions and forms"). Modal: focus stays inside,
 * the page behind is dimmed by the backdrop; Escape, the close button or a press on the backdrop
 * closes it, but not while its form is `sending`, and focus returns to what opened it.
 *
 * Its body scrolls between the header and the actions, its padding inside the scroller: a focused
 * field's ring is never clipped.
 *
 * Motion: it slides in from its edge in 300 ms, ease-out, and out in 200 ms, ease-in, while the
 * backdrop fades in and out in 200 ms; cut under reduced motion.
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

/**
 * A long form: focus on its first field, Cancel, then the submit button; an empty name is refused
 * under its field, and while the form is sent nothing closes the sheet.
 */
export const WithForm: Story = { render: () => <NewAccount /> };

/** A long form on a phone: a bottom sheet, its actions stacked, the main one on top. */
export const WithFormOnPhone: Story = {
  render: () => <NewAccount />,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
