import type { Benchmark, EntryKind } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { CategoryPicker } from "@gousset/ui/components/category-picker";
import type { CategoryChoice } from "@gousset/ui/components/category-picker";
import { Dialog, DialogClose } from "@gousset/ui/components/dialog";
import { FormMessage } from "@gousset/ui/components/form-message";
import { MoneyField } from "@gousset/ui/components/money-field";
import { SegmentedChoice } from "@gousset/ui/components/segmented-choice";
import { Select } from "@gousset/ui/components/select";
import type { ChoiceItem } from "@gousset/ui/components/select";
import { TextField } from "@gousset/ui/components/text-field";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { categoryRefusalMessage } from "@/i18n/messages";
import { whileBusy } from "@/lib/while-busy";

/** What a change of the categories answers: done, or refused with a code (and the fallback). */
export type CategoryAnswer = { ok: true } | { ok: false; code: string; fallback?: string | null };

/** The value of the "Under" select that stands for the top level. */
const TOP = "top";

/** A dialog's controlled state, from the page. */
type Opened = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * One form in a dialog (docs/design.md: every form asks in a dialog): its fields, the refusal in
 * words under them, Cancel and the submit button, busy while the server answers. It closes once
 * the change is done.
 */
function CategoryDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
  children,
}: Opened & {
  title: string;
  description?: string;
  submitLabel: string;
  /** Runs on submit; `undefined` when the form's own check stopped it. */
  onSubmit: () => Promise<CategoryAnswer | undefined>;
  children: ReactNode;
}) {
  const formId = useId();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    const answer = await whileBusy(setBusy, onSubmit);

    if (answer === undefined) {
      return;
    }

    if (!answer.ok) {
      setError(categoryRefusalMessage(answer.code, answer.fallback));

      return;
    }

    setError(undefined);
    onOpenChange(false);
  }

  return (
    <Dialog
      title={title}
      description={description}
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <DialogClose>
            <Button type="button" variant="secondary">
              {m.uiCancel()}
            </Button>
          </DialogClose>
          <Button type="submit" form={formId} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
      >
        {children}
        <FormMessage message={error} />
      </form>
    </Dialog>
  );
}

function NameField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <TextField
      label={m.fieldName()}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete="off"
      required
    />
  );
}

/** "At the top level", then each top-level category one may go under. */
function parentItems(parents: ReadonlyArray<{ id: string; name: string }>) {
  return [
    { value: TOP, label: m.categoriesTopLevel() },
    ...parents.map((parent) => ({ value: parent.id, label: parent.name })),
  ];
}

const KINDS = ["expense", "income"] as const satisfies ReadonlyArray<EntryKind>;

function isKind(value: string): value is EntryKind {
  return value === "expense" || value === "income";
}

/** "Add a category": its kind, its name, and the top-level category it goes under, if any. */
export function CreateCategoryDialog({
  initialKind,
  parentsOfKind,
  onCreate,
  ...opened
}: Opened & {
  initialKind: EntryKind;
  /** The top-level categories in use of each kind. */
  parentsOfKind: (kind: EntryKind) => ReadonlyArray<{ id: string; name: string }>;
  onCreate: (input: {
    kind: EntryKind;
    name: string;
    parentId: string | null;
  }) => Promise<CategoryAnswer>;
}) {
  const [kind, setKind] = useState<EntryKind>(initialKind);
  const [name, setName] = useState("");
  const [parent, setParent] = useState(TOP);

  const kindItems: ReadonlyArray<ChoiceItem> = KINDS.map((value) => ({
    value,
    label: value === "expense" ? m.categoriesKindExpense() : m.categoriesKindIncome(),
  }));

  return (
    <CategoryDialog
      {...opened}
      title={m.categoriesCreateTitle()}
      submitLabel={m.categoriesCreateSubmit()}
      onSubmit={() => onCreate({ kind, name, parentId: parent === TOP ? null : parent })}
    >
      <Select
        label={m.fieldKind()}
        items={kindItems}
        value={kind}
        onValueChange={(value) => {
          if (value !== null && isKind(value) && value !== kind) {
            setKind(value);
            // A parent of the other kind cannot be kept.
            setParent(TOP);
          }
        }}
        required
      />
      <NameField value={name} onChange={setName} />
      <Select
        label={m.categoriesFieldParent()}
        items={parentItems(parentsOfKind(kind))}
        value={parent}
        onValueChange={(value) => setParent(value ?? TOP)}
        required
      />
    </CategoryDialog>
  );
}

/** "Rename": its name only. */
export function RenameCategoryDialog({
  name: initial,
  onRename,
  ...opened
}: Opened & { name: string; onRename: (name: string) => Promise<CategoryAnswer> }) {
  const [name, setName] = useState(initial);

  return (
    <CategoryDialog
      {...opened}
      title={m.categoriesRenameTitle({ name: initial })}
      submitLabel={m.categoriesRenameSubmit()}
      onSubmit={() => onRename(name)}
    >
      <NameField value={name} onChange={setName} />
    </CategoryDialog>
  );
}

/** "Move under…": the top level, or a top-level category of its kind. */
export function MoveCategoryDialog({
  name,
  parentId,
  parents,
  onMove,
  ...opened
}: Opened & {
  name: string;
  parentId: string | null;
  parents: ReadonlyArray<{ id: string; name: string }>;
  onMove: (parentId: string | null) => Promise<CategoryAnswer>;
}) {
  const [parent, setParent] = useState(parentId ?? TOP);

  return (
    <CategoryDialog
      {...opened}
      title={m.categoriesMoveTitle({ name })}
      description={m.categoriesMoveDescription()}
      submitLabel={m.categoriesMoveSubmit()}
      onSubmit={() => onMove(parent === TOP ? null : parent)}
    >
      <Select
        label={m.categoriesFieldParent()}
        items={parentItems(parents)}
        value={parent}
        onValueChange={(value) => setParent(value ?? TOP)}
        required
      />
    </CategoryDialog>
  );
}

/** "Merge with…": the category of its kind its lines go to. */
export function MergeCategoryDialog({
  name,
  targets,
  onMerge,
  ...opened
}: Opened & {
  name: string;
  targets: ReadonlyArray<CategoryChoice>;
  onMerge: (intoId: string) => Promise<CategoryAnswer>;
}) {
  const [into, setInto] = useState<string | null>(null);

  return (
    <CategoryDialog
      {...opened}
      title={m.categoriesMergeTitle({ name })}
      description={m.categoriesMergeDescription()}
      submitLabel={m.categoriesMergeSubmit()}
      onSubmit={async () => (into === null ? undefined : onMerge(into))}
    >
      <CategoryPicker
        label={m.categoriesMergeInto()}
        placeholder={m.categoriesSearch()}
        categories={targets}
        value={into}
        onValueChange={setInto}
        required
      />
    </CategoryDialog>
  );
}

type BenchmarkMode = Benchmark["mode"];

/** "Benchmark": automatic (the six-month average), an amount set in `currency`, or none. */
export function BenchmarkDialog({
  name,
  benchmark,
  currency,
  onSave,
  ...opened
}: Opened & {
  name: string;
  benchmark: Benchmark;
  /** The user's currency, the one a set amount is in. */
  currency: string;
  onSave: (benchmark: Benchmark) => Promise<CategoryAnswer>;
}) {
  const [mode, setMode] = useState<BenchmarkMode>(benchmark.mode);

  const [minor, setMinor] = useState<number | null>(
    benchmark.mode === "fixed" ? benchmark.minor : null,
  );

  const [invalid, setInvalid] = useState(false);

  async function save(): Promise<CategoryAnswer | undefined> {
    if (mode !== "fixed") {
      return onSave({ mode });
    }

    if (minor === null || minor < 0) {
      setInvalid(true);

      return undefined;
    }

    return onSave({ mode, minor });
  }

  return (
    <CategoryDialog
      {...opened}
      title={m.categoriesBenchmarkTitle({ name })}
      description={m.categoriesBenchmarkDescription()}
      submitLabel={m.categoriesBenchmarkSubmit()}
      onSubmit={save}
    >
      <SegmentedChoice
        label={m.categoriesBenchmark()}
        value={mode}
        choices={[
          { value: "automatic", label: m.categoriesBenchmarkAutomatic() },
          { value: "fixed", label: m.categoriesBenchmarkFixed() },
          { value: "none", label: m.categoriesBenchmarkNone() },
        ]}
        onChange={setMode}
      />
      {mode === "fixed" ? (
        <MoneyField
          label={m.categoriesBenchmarkAmount()}
          currency={currency}
          defaultValue={minor}
          error={invalid ? m.categoriesBenchmarkAmountInvalid() : undefined}
          onValueChange={(value) => {
            setInvalid(false);
            setMinor(value);
          }}
          required
        />
      ) : null}
    </CategoryDialog>
  );
}
