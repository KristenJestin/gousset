import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Button } from "./button";
import { AlertDialog, Dialog, DialogClose } from "./dialog";
import { TextField } from "./text-field";

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function RenameDialog() {
  return (
    <Dialog
      trigger={<Button variant="secondary">Rename the account</Button>}
      title="Rename the account"
      description="The name shows on every screen; the bank's own name stays in the statements."
      actions={
        <>
          <DialogClose>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose>
            <Button>Save</Button>
          </DialogClose>
        </>
      }
    >
      <TextField label="Name" defaultValue="Current account" />
    </Dialog>
  );
}

/** Opened from outside, with no trigger of its own. */
function Controlled() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open from code
      </Button>
      <p className="text-sm text-muted-foreground">{open ? "Open" : "Closed"}</p>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Statement imported"
        description="12 lines added to the current account, 3 to review."
      />
    </div>
  );
}

function DeleteRule() {
  const [deleted, setDeleted] = useState(false);

  return (
    <div className="flex flex-col items-start gap-3">
      <AlertDialog
        trigger={<Button variant="destructive">Delete the rule</Button>}
        title="Delete this rule?"
        description="Lines from Greenmarket will no longer be put in Groceries on their own. Lines already sorted stay as they are."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await wait(800);
          setDeleted(true);
        }}
      />
      <p className="text-sm text-muted-foreground">{deleted ? "Deleted" : "Kept"}</p>
    </div>
  );
}

/**
 * A focused task over the page: a title, a description, a body, actions (`Button`s, the main one
 * last; `DialogClose` makes one close it) and a close button in the corner. Modal: focus stays
 * inside, the page behind is inert; Escape, the close button or a press outside closes it, and
 * focus returns to what opened it. `AlertDialog` asks a question that must be answered (Cancel or
 * the agreeing answer); a press outside does not close it, and a confirmation that returns a
 * promise keeps it open, the button busy, until it settles.
 *
 * Motion: the dialog fades and grows in 200 ms, ease-out, the page behind veils in 200 ms; both
 * leave the same way. Cut under reduced motion.
 *
 * Don't: open a dialog from a dialog, use it for what a page or a `Sheet` holds better (a line's
 * detail, a long form), or ask "Are you sure?" where an undo would do.
 */
const meta = {
  title: "Overlays/Dialog",
  component: RenameDialog,
} satisfies Meta<typeof RenameDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Controlled: opened from code, with only a title and a description. */
export const OpenFromCode: Story = { render: () => <Controlled /> };

/** A confirmation: Cancel, and Delete, which stays busy while it runs. */
export const Confirmation: Story = { render: () => <DeleteRule /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
