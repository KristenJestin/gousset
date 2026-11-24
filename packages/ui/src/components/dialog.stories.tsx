import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";

import { Button } from "./button";
import { AlertDialog, Dialog, DialogClose } from "./dialog";
import { Sheet } from "./sheet";
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

/**
 * A form in a dialog, as a page holds an action that asks for input: it stays open while a refusal
 * shows under its field, and closes once the form is accepted.
 */
function NoteBalance() {
  const [open, setOpen] = useState(false);
  const [refused, setRefused] = useState(false);
  const [noted, setNoted] = useState(false);

  return (
    <div className="flex flex-col items-start gap-3">
      <Dialog
        trigger={<Button icon="add">Note a balance</Button>}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setRefused(false);
        }}
        title="Note a balance"
        description="What the bank shows today for the current account."
        onSubmit={(event) => {
          event.preventDefault();

          if (new FormData(event.currentTarget).get("balance") === "") {
            setRefused(true);

            return;
          }

          setNoted(true);
          setOpen(false);
        }}
        onInput={() => setRefused(false)}
        actions={<Button type="submit">Note it</Button>}
      >
        <TextField
          label="Balance"
          name="balance"
          error={refused ? "Write the amount the bank shows." : undefined}
        />
      </Dialog>
      <p className="text-sm text-muted-foreground">{noted ? "Noted" : "Nothing noted"}</p>
    </div>
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

const FIRST_LINE = "CB GREENMARKET";
const NEXT_LINE = "CB STREAMLY";

/**
 * A dialog the page opens over a line's sheet, as the app's `?` opens the list of shortcuts: a key
 * of the page's own, heard wherever the focus is. The sheet's "Next line" puts the next line's
 * sheet in its place while it is open, as the review does.
 */
function OverSheet() {
  const [line, setLine] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      if (event.key === "?") {
        setHelp(true);
      }
    };

    document.addEventListener("keydown", listen);

    return () => document.removeEventListener("keydown", listen);
  }, []);

  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="secondary" onClick={() => setLine(FIRST_LINE)}>
        Open a line
      </Button>
      {line === null ? null : (
        <Sheet
          key={line}
          open
          onOpenChange={(next) => {
            if (!next) {
              setLine(null);
            }
          }}
          title={line}
          description="Press ? for the keyboard shortcuts."
        >
          <Button
            variant="secondary"
            onClick={() => setLine(line === FIRST_LINE ? NEXT_LINE : FIRST_LINE)}
          >
            Next line
          </Button>
        </Sheet>
      )}
      <Dialog open={help} onOpenChange={setHelp} title="Keyboard shortcuts">
        <p>? shows this list.</p>
      </Dialog>
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
          // Long enough to see the loader, which shows only after 300 ms.
          await wait(2000);
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
 * inside, the page behind is inert and dimmed by the backdrop; Escape, the close button or a press
 * on the backdrop closes it (not while its form is `sending`), and focus returns to what opened it. `AlertDialog` asks a question that must be answered (Cancel or
 * the agreeing answer); a press outside does not close it, and a confirmation that returns a
 * promise keeps it open, the button busy, until it settles.
 *
 * An action that asks for input (create, edit, reset, note a balance) is a button opening a
 * dialog that holds its form (`onSubmit`): the body and actions are one form, Cancel comes first,
 * and the page closes it once the form is accepted. On a phone (below 768 px) the dialog is a
 * sheet along the bottom edge.
 *
 * Motion: the dialog fades and grows from 96 % in 200 ms, ease-out, and leaves in 150 ms, ease-in;
 * on a phone it rises from the bottom edge in 300 ms and goes back down in 200 ms. The backdrop
 * fades in and out in 200 ms. Cut under reduced motion.
 *
 * Don't: open a dialog from a dialog, put an action's form inline in a page, use it for what a
 * page or a `Sheet` holds better (a line's detail, a long form), or ask "Are you sure?" where an undo would do.
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

/** A form: Cancel, then the submit button; an empty balance is refused under its field. */
export const WithForm: Story = { render: () => <NoteBalance /> };

/** A form on a phone: a sheet along the bottom edge. */
export const WithFormOnPhone: Story = {
  render: () => <NoteBalance />,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

/**
 * Over a sheet, opened by a key of the page: the topmost, so Escape closes it alone, and focus goes
 * into it and back to the sheet.
 */
export const OverASheet: Story = { render: () => <OverSheet /> };

/** A confirmation: Cancel, and Delete, which stays busy while it runs. */
export const Confirmation: Story = { render: () => <DeleteRule /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
