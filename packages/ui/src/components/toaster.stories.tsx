import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { notify, toaster } from "../lib/notify";
import { MERCHANTS } from "../stories/made-up";
import { Button } from "./button";
import { Toaster } from "./toaster";

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** The toaster, as the app places it, and the story's buttons; every toast goes when it leaves. */
function Stage({ children }: { children?: ReactNode }) {
  useEffect(() => () => notify.dismiss(), []);

  return (
    <>
      <Toaster />
      <div className="flex flex-col items-start gap-3 text-sm">{children}</div>
    </>
  );
}

function saveGroceries() {
  notify.saved({ description: "Greenmarket · Groceries" });
}

function SavedDemo() {
  useEffect(saveGroceries, []);

  return (
    <Stage>
      <Button onClick={saveGroceries}>Save</Button>
    </Stage>
  );
}

function failImport() {
  notify.failed({ description: "statement.ofx could not be read.", retry: () => wait(800) });
}

function FailedDemo() {
  useEffect(failImport, []);

  return (
    <Stage>
      <Button variant="secondary" onClick={failImport}>
        Fail again
      </Button>
    </Stage>
  );
}

/** An import: reading, then matching, then resolved in place to "12 lines added". */
function startImport() {
  const progress = notify.progress("import", { title: "Reading statement.ofx" });
  const matching = setTimeout(() => progress.update({ title: "Matching 12 lines" }), 1500);

  const done = setTimeout(
    () => progress.succeed({ title: "12 lines added", description: "Current account" }),
    3000,
  );

  return () => {
    clearTimeout(matching);
    clearTimeout(done);
  };
}

function ProgressDemo() {
  useEffect(() => startImport(), []);

  return (
    <Stage>
      <Button
        icon="import"
        onClick={() => {
          startImport();
        }}
      >
        Import statement
      </Button>
    </Stage>
  );
}

function startFailingImport() {
  const progress = notify.progress("import", { title: "Reading statement.ofx" });

  const failed = setTimeout(
    () =>
      progress.fail({
        description: "statement.ofx is not a bank statement.",
        retry: () => wait(800),
      }),
    1500,
  );

  return () => clearTimeout(failed);
}

function ProgressFailingDemo() {
  useEffect(() => startFailingImport(), []);

  return (
    <Stage>
      <Button
        icon="import"
        onClick={() => {
          startFailingImport();
        }}
      >
        Import statement
      </Button>
    </Stage>
  );
}

function UndoDemo({ fails }: { fails: boolean }) {
  const [undone, setUndone] = useState(0);

  const approve = () => {
    notify.undo({
      title: "Line approved",
      description: "Greenmarket · €31.24",
      onUndo: async () => {
        await wait(600);

        if (fails) {
          throw new Error("The server refused");
        }

        setUndone((count) => count + 1);
      },
    });
  };

  useEffect(approve, [fails]);

  return (
    <Stage>
      <Button icon="check" onClick={approve}>
        Approve line
      </Button>
      <p>{undone === 0 ? "Line approved" : "Line back to review"}</p>
    </Stage>
  );
}

function showMany() {
  for (const merchant of MERCHANTS) {
    notify.saved({ description: merchant.name });
  }
}

function StackDemo({ focus }: { focus: boolean }) {
  useEffect(() => {
    showMany();

    if (!focus) {
      return;
    }

    // As F6 would: focus in the stack expands it.
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-slot="toast"][data-front]')?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [focus]);

  return (
    <Stage>
      <Button variant="secondary" onClick={showMany}>
        Save five merchants
      </Button>
    </Stage>
  );
}

function FrenchDemo() {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;

    root.lang = "fr";
    notify.saved({ description: "Greenmarket · Courses" });
    notify.undo({ title: "Ligne validée", description: "Greenmarket · 31,24 €", onUndo: () => {} });
    notify.failed({ description: "statement.ofx n’est pas un relevé bancaire.", retry: () => {} });

    return () => {
      root.lang = before;
    };
  }, []);

  return <Stage />;
}

function StackedFollowUpDemo() {
  useEffect(() => {
    notify.progress("import", { title: "Reading statement.ofx" });

    const done = setTimeout(() => notify.saved({ description: "12 lines added" }), 1000);

    return () => clearTimeout(done);
  }, []);

  return <Stage />;
}

function PageWordingDemo() {
  useEffect(() => {
    toaster.success("Changes saved successfully!");
    toaster.error("Oops, error 500");
  }, []);

  return <Stage />;
}

/**
 * Toasts: what just happened, said briefly at the edge of the screen. Pages never draw one: they
 * call `notify` (`@gousset/ui/lib/notify`), from anywhere (no React needed), and the app places
 * `<Toaster />` once, near the root of `<body>`. Built on ui-sdk's `Toast`: live announcements,
 * the Notifications landmark, F6 to reach it and back, Escape to dismiss, timers paused on hover
 * and focus, swipe toward the edge.
 *
 * - `notify.saved({ description? })`: "Saved", success, leaves after 4 s.
 * - `notify.failed({ description?, retry?, id? })`: "Something went wrong", error, announced
 *   assertively, stays until dismissed; `retry` adds a Retry button.
 * - `notify.progress(id, { title?, description? })`: the loader and the caller's words, stays;
 *   returns `{ update, succeed, fail }`, which change the same toast in place. Calling
 *   `notify.progress` again with the same id does too.
 * - `notify.undo({ title, description?, onUndo, id? })`: an Undo button for 6 s. The callback
 *   runs with the button busy, then the same toast says "Undone" (4 s), or "Couldn't undo" with
 *   Retry (stays).
 * - `notify.dismiss(id?)`: closes one, or all.
 *
 * The generic words come from the `notify` messages, in the page's language; what names the
 * user's data ("12 lines added", a merchant) comes from the caller, already translated.
 *
 * At most three show, the newest in front and the others peeking behind; the stack expands on
 * hover and focus. Bottom right on desktop, top on a phone (below 40rem), above the navigation.
 *
 * Motion: a toast slides in from its edge and fades, leaves by fading, and the stack moves in
 * 300 ms, easing out (CSS). A toast that changes in place springs to its new size, its words fade
 * in and its mark swaps (the loader becomes a check) with a spring (Motion, about 300 ms); a second
 * change mid-flight retargets without a jump. All of it is cut under reduced motion.
 *
 * Don't: stack a new toast for a follow-up (resolve the progress, or reuse its id); write a
 * toast's wording in a page, or call `toaster` directly; use a toast for what must stay on screen
 * (an error that blocks a form belongs beside its field).
 */
const meta = {
  title: "Feedback/Toaster",
  component: Toaster,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Toaster>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Success: "Saved", with what was saved; leaves after 4 s. */
export const Saved: Story = { render: () => <SavedDemo /> };

/** Error: announced at once, stays until dismissed, with Retry. */
export const Failed: Story = { render: () => <FailedDemo /> };

/**
 * Progress resolved in place: "Reading statement.ofx", then "Matching 12 lines", then "12 lines
 * added", in one toast. Press the button again mid-way: the same toast starts over.
 */
export const Progress: Story = { render: () => <ProgressDemo /> };

/** Progress resolved in place to an error, with Retry. */
export const ProgressFailing: Story = { render: () => <ProgressFailingDemo /> };

/** With an action: Undo runs its callback, then the same toast says "Undone". */
export const Undo: Story = { render: () => <UndoDemo fails={false} /> };

/** The undo fails: the same toast says "Couldn't undo", with Retry, and stays. */
export const UndoFailing: Story = { render: () => <UndoDemo fails /> };

/** Five at once: three show, the two oldest wait their turn. Hover the stack to expand it. */
export const MoreThanThree: Story = { render: () => <StackDemo focus={false} /> };

/** The stack expanded, as hover or focus (F6) leave it: each toast in full, 12 px apart. */
export const Expanded: Story = { render: () => <StackDemo focus /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <UndoDemo fails={false} />,
};

/** `<html lang="fr">`: the words of `notify` follow; the caller's words come in French. */
export const French: Story = { render: () => <FrenchDemo /> };

/**
 * Don't: a new toast for a follow-up. The import's progress keeps turning while "Saved" stacks
 * beside it; resolve the progress instead (`progress.succeed`).
 */
export const DontStackAFollowUp: Story = { render: () => <StackedFollowUpDemo /> };

/**
 * Don't: wording written in a page, through `toaster`. Two pages, two voices; `notify` says it the
 * same way everywhere, in the page's language.
 */
export const DontWriteWordingInAPage: Story = { render: () => <PageWordingDemo /> };
