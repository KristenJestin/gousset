import type { EntryKind, MerchantDetail } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { AccountLines } from "@gousset/ui/components/account-lines";
import type { AccountLineRow } from "@gousset/ui/components/account-lines";
import { Block, ScreenBlock } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import { CategoryPicker } from "@gousset/ui/components/category-picker";
import { Dialog } from "@gousset/ui/components/dialog";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { FormMessage } from "@gousset/ui/components/form-message";
import { List, ListItem } from "@gousset/ui/components/list";
import { NameField } from "@gousset/ui/components/name-field";
import { Actions } from "@gousset/ui/components/screen";
import { SegmentedChoice } from "@gousset/ui/components/segmented-choice";
import { TextField } from "@gousset/ui/components/text-field";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { notify } from "@gousset/ui/lib/notify";
import { useDebouncer } from "@tanstack/react-pacer";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { AppLink } from "@/components/app-link";
import {
  mergeMerchant,
  moveMerchantLabel,
  renameMerchant,
  setMerchantCategory,
} from "@/functions/merchants";
import type { MerchantRefusalCode } from "@/functions/merchants";
import { merchantRefusalMessage } from "@/i18n/messages";
import { shortDays } from "@/lib/account-day";
import { categoryPath, choicesOf } from "@/lib/categories";
import { labelsCount } from "@/lib/merchant-words";
import { whileBusy } from "@/lib/while-busy";
import { categoryQueries } from "@/queries/categories";
import { invalidateMerchantEntries } from "@/queries/invalidate";
import { invalidateMerchants, merchantQueries } from "@/queries/merchants";

/** How long a name field waits for the typing to stop before it asks for suggestions. */
const TYPING_WAIT_MS = 200;

/**
 * One merchant (#24): its name, its default category (#23), the cleaned labels that name it and
 * its latest lines, with what the user does to it, each in a dialog: rename it, choose its default
 * category, merge it into another merchant, or move one of its labels to another merchant (a new
 * one when the name is new), which splits it.
 *
 * Motion: each dialog fades and grows in over 200 ms, ease-out, and leaves the same way (`Dialog`);
 * the category picker's list fades and grows in over 150 ms (`Combobox`); the toast that says what
 * was done slides in (`Toaster`); the page then shows the merchant as it is now, without animating
 * the change. Cut under reduced motion.
 */
export const Route = createFileRoute("/_authed/settings/merchants/$merchantId")({
  loader: async ({ context: { queryClient }, params }) => {
    const detail = await queryClient.ensureQueryData(merchantQueries.detail(params.merchantId));

    if (!detail.ok) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's not-found signal is a plain object it catches by design.
      throw notFound();
    }
  },
  notFoundComponent: MerchantNotFound,
  component: MerchantPage,
});

function MerchantNotFound() {
  return (
    <ScreenBlock>
      <EmptyState
        icon="merchant"
        title={m.merchantNotFoundTitle()}
        description={m.merchantNotFoundDescription()}
      />
    </ScreenBlock>
  );
}

/** The detail, unwrapped: the loader already turned a refusal into "not found" before this runs. */
function useMerchantDetail(merchantId: string): MerchantDetail {
  const { data } = useSuspenseQuery(merchantQueries.detail(merchantId));

  if (!data.ok) {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's not-found signal is a plain object it catches by design.
    throw notFound();
  }

  return data.merchant;
}

/** Which dialog is open, and its opening's count: each opening starts afresh. */
type OpenDialog =
  | { kind: "rename"; opened: number }
  | { kind: "category"; opened: number }
  | { kind: "merge"; opened: number }
  | { kind: "move"; label: string; opened: number };

function MerchantPage() {
  const { merchantId } = Route.useParams();
  const merchant = useMerchantDetail(merchantId);
  const locale = usePageLanguage();
  const [dialog, setDialog] = useState<OpenDialog>();
  const [open, setOpen] = useState(false);

  const show = (next: OpenDialog) => {
    setDialog(next);
    setOpen(true);
  };

  const opened = (dialog?.opened ?? 0) + 1;
  const dayOf = shortDays(locale);

  const rows = merchant.lines.map((line): AccountLineRow => ({
    id: line.id,
    day: dayOf(line.bookedOn),
    label: line.label,
    tag: line.account.name,
    amount: line.amount,
  }));

  return (
    <>
      <Block title={merchant.name} description={labelsCount(merchant.aliases.length, locale)}>
        <Actions>
          <Button variant="secondary" icon="edit" onClick={() => show({ kind: "rename", opened })}>
            {m.merchantRename()}
          </Button>
          <Button variant="secondary" onClick={() => show({ kind: "merge", opened })}>
            {m.merchantMerge()}
          </Button>
          <AppLink to="/settings/merchants">{m.merchantsAll()}</AppLink>
        </Actions>
      </Block>
      <Block title={m.merchantDefaultTitle()} description={m.merchantDefaultDescription()}>
        <List label={m.merchantDefaultTitle()}>
          <ListItem
            title={
              merchant.defaultCategory === null
                ? m.merchantDefaultNone()
                : categoryPath(merchant.defaultCategory)
            }
            description={defaultDescription(merchant)}
            action={
              <Button
                variant="secondary"
                aria-label={m.merchantDefaultChangeLabel({ name: merchant.name })}
                onClick={() => show({ kind: "category", opened })}
              >
                {m.merchantDefaultChange()}
              </Button>
            }
          />
        </List>
      </Block>
      <Block title={m.merchantLabelsTitle()} description={m.merchantLabelsDescription()}>
        <List label={m.merchantLabelsTitle()}>
          {merchant.aliases.map((alias) => (
            <ListItem
              key={alias}
              title={alias}
              action={
                <Button
                  variant="secondary"
                  aria-label={m.merchantMoveLabel({ label: alias })}
                  onClick={() => show({ kind: "move", label: alias, opened })}
                >
                  {m.merchantMove()}
                </Button>
              }
            />
          ))}
        </List>
      </Block>
      <Block title={m.merchantLinesTitle()}>
        <AccountLines rows={rows} emptyText={m.merchantLinesEmpty()} locale={locale} />
      </Block>
      {dialog?.kind === "rename" ? (
        <RenameDialog key={dialog.opened} open={open} onOpenChange={setOpen} merchant={merchant} />
      ) : null}
      {dialog?.kind === "category" ? (
        <DefaultCategoryDialog
          key={dialog.opened}
          open={open}
          onOpenChange={setOpen}
          merchant={merchant}
        />
      ) : null}
      {dialog?.kind === "merge" ? (
        <MergeDialog key={dialog.opened} open={open} onOpenChange={setOpen} merchant={merchant} />
      ) : null}
      {dialog?.kind === "move" ? (
        <MoveDialog
          key={dialog.opened}
          open={open}
          onOpenChange={setOpen}
          label={dialog.label}
          merchant={merchant}
        />
      ) : null}
    </>
  );
}

const kindLabel = (kind: EntryKind) =>
  kind === "expense" ? m.categoriesKindExpense() : m.categoriesKindIncome();

/** Under the default category: its kind, or that it is archived; nothing when there is none. */
function defaultDescription(merchant: MerchantDetail): string | undefined {
  const chosen = merchant.defaultCategory;

  if (chosen === null) {
    return undefined;
  }

  return chosen.archived ? m.merchantDefaultArchived() : kindLabel(chosen.kind);
}

/** A call that failed outright, as a refusal the forms can show. */
type Failed = { ok: false; code: "UNKNOWN"; name: undefined };

const FAILED: Failed = { ok: false, code: "UNKNOWN", name: undefined };

/** A failed call answers a refusal: the React Compiler has no `try` to handle in a component. */
function answerOf<Answer>(call: Promise<Answer>): Promise<Answer | Failed> {
  return call.then(
    (answer) => answer,
    () => FAILED,
  );
}

/** The refusals about the name typed, shown under its field; the others under the form. */
const NAME_REFUSALS: ReadonlySet<string> = new Set([
  "NAME_BLANK",
  "NAME_TOO_LONG",
  "NAME_TAKEN",
  "MERGE_INTO_ITSELF",
  "MERGE_INTO_UNKNOWN",
]);

/** A refusal's message, and where it shows: under the name field or under the form. */
function refusalOf(answer: {
  code: MerchantRefusalCode | Failed["code"];
  name: string | undefined;
}): Refusal {
  const message = merchantRefusalMessage(answer.code, answer.name);

  return NAME_REFUSALS.has(answer.code)
    ? { field: message, form: undefined }
    : { field: undefined, form: message };
}

type Refusal = { field: string | undefined; form: string | undefined };

const NO_REFUSAL: Refusal = { field: undefined, form: undefined };

/**
 * A dialog whose form is its body and whose submit button is its main action (docs/design.md,
 * "Actions and forms"): it stays open while the form is sent.
 */
function FormDialog({
  title,
  description,
  submitLabel,
  open,
  onOpenChange,
  busy,
  onSubmit,
  children,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      title={title}
      description={description}
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) {
          return;
        }

        onOpenChange(next);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      actions={
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      }
    >
      {children}
    </Dialog>
  );
}

/**
 * The merchants' names a name field offers for what was typed, once the typing stops (`typed`
 * takes each change); `except`, a name never offered (the merchant itself).
 */
function useNameSuggestions(except: string) {
  const [text, setText] = useState("");
  const typing = useDebouncer(setText, { wait: TYPING_WAIT_MS });
  const { data } = useQuery(merchantQueries.names(text.trim()));

  return {
    suggestions: (data ?? []).filter((name) => name !== except),
    typed: (value: string) => typing.maybeExecute(value),
  };
}

function RenameDialog({
  open,
  onOpenChange,
  merchant,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchant: MerchantDetail;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(merchant.name);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(NO_REFUSAL);

  async function rename() {
    const answer = await whileBusy(setBusy, () =>
      answerOf(renameMerchant({ data: { merchantId: merchant.id, name } })),
    );

    if (!answer.ok) {
      setRefusal(refusalOf(answer));

      return;
    }

    setRefusal(NO_REFUSAL);
    await invalidateMerchants(queryClient);
    notify.saved({
      description: m.merchantRenamed({ before: merchant.name, after: answer.merchant.name }),
    });
    onOpenChange(false);
  }

  return (
    <FormDialog
      title={m.merchantRenameTitle({ name: merchant.name })}
      submitLabel={m.merchantRenameSubmit()}
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      onSubmit={() => void rename()}
    >
      <TextField
        label={m.fieldName()}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={refusal.field}
        autoComplete="off"
        required
      />
      <FormMessage message={refusal.form} />
    </FormDialog>
  );
}

function MergeDialog({
  open,
  onOpenChange,
  merchant,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchant: MerchantDetail;
}) {
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const [into, setInto] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(NO_REFUSAL);
  const { suggestions, typed } = useNameSuggestions(merchant.name);

  async function merge() {
    const answer = await whileBusy(setBusy, () =>
      answerOf(mergeMerchant({ data: { merchantId: merchant.id, into } })),
    );

    if (!answer.ok) {
      setRefusal(refusalOf(answer));

      return;
    }

    setRefusal(NO_REFUSAL);
    onOpenChange(false);
    // This merchant is gone: the page of the one kept, which took its labels, takes its place.
    await navigate({
      to: "/settings/merchants/$merchantId",
      params: { merchantId: answer.merged.into.id },
    });
    await invalidateMerchantEntries(queryClient);
    notify.saved({
      description: m.merchantMerged({
        merged: answer.merged.merged,
        into: answer.merged.into.name,
      }),
    });
  }

  return (
    <FormDialog
      title={m.merchantMergeTitle({ name: merchant.name })}
      description={m.merchantMergeDescription({ name: merchant.name })}
      submitLabel={m.merchantMergeSubmit()}
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      onSubmit={() => void merge()}
    >
      <NameField
        label={m.merchantMergeInto()}
        placeholder={m.merchantNamePlaceholder()}
        value={into}
        onValueChange={(value) => {
          setInto(value);
          typed(value);
        }}
        suggestions={suggestions}
        error={refusal.field}
        required
      />
      <FormMessage message={refusal.form} />
    </FormDialog>
  );
}

function MoveDialog({
  open,
  onOpenChange,
  label,
  merchant,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  merchant: MerchantDetail;
}) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(NO_REFUSAL);
  const { suggestions, typed } = useNameSuggestions(merchant.name);

  async function move() {
    const answer = await whileBusy(setBusy, () =>
      answerOf(moveMerchantLabel({ data: { merchantId: merchant.id, label, to } })),
    );

    if (!answer.ok) {
      setRefusal(refusalOf(answer));

      return;
    }

    setRefusal(NO_REFUSAL);
    await invalidateMerchantEntries(queryClient);

    const { moved } = answer;

    notify.saved({
      description: moved.created
        ? m.merchantMovedToNew({ label: moved.alias, merchant: moved.to.name })
        : m.merchantMoved({ label: moved.alias, merchant: moved.to.name }),
    });
    onOpenChange(false);
  }

  return (
    <FormDialog
      title={m.merchantMoveTitle({ label })}
      description={m.merchantMoveDescription()}
      submitLabel={m.merchantMoveSubmit()}
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      onSubmit={() => void move()}
    >
      <NameField
        label={m.merchantMoveTo()}
        placeholder={m.merchantNamePlaceholder()}
        value={to}
        onValueChange={(value) => {
          setTo(value);
          typed(value);
        }}
        suggestions={suggestions}
        error={refusal.field}
        required
      />
      <FormMessage message={refusal.form} />
    </FormDialog>
  );
}

/** What the dialog offers first: a kind's categories, or none. */
type DefaultChoice = EntryKind | "none";

/**
 * The merchant's default category: none, or a category in use of the kind chosen (a merchant may
 * be paid, or pay: an employer), found by typing. One archived is shown on the page, never offered.
 */
function DefaultCategoryDialog({
  open,
  onOpenChange,
  merchant,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchant: MerchantDetail;
}) {
  const queryClient = useQueryClient();
  const { data: tree } = useQuery(categoryQueries.list());
  const current = merchant.defaultCategory;
  const [choice, setChoice] = useState<DefaultChoice>(current?.kind ?? "expense");

  const [categoryId, setCategoryId] = useState(
    current === null || current.archived ? null : current.id,
  );

  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(NO_REFUSAL);

  async function save() {
    if (choice !== "none" && categoryId === null) {
      setRefusal({ field: m.merchantDefaultChoose(), form: undefined });

      return;
    }

    const chosen = choice === "none" ? null : categoryId;

    const answer = await whileBusy(setBusy, () =>
      answerOf(setMerchantCategory({ data: { merchantId: merchant.id, categoryId: chosen } })),
    );

    if (!answer.ok) {
      setRefusal(refusalOf(answer));

      return;
    }

    setRefusal(NO_REFUSAL);
    await invalidateMerchantEntries(queryClient);
    notify.saved({
      description:
        answer.category === null
          ? m.merchantDefaultCleared({ merchant: merchant.name })
          : m.merchantDefaultSet({
              merchant: merchant.name,
              category: categoryPath(answer.category),
            }),
    });
    onOpenChange(false);
  }

  return (
    <FormDialog
      title={m.merchantDefaultDialogTitle({ name: merchant.name })}
      description={m.merchantDefaultDescription()}
      submitLabel={m.merchantDefaultSubmit()}
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      onSubmit={() => void save()}
    >
      <SegmentedChoice
        label={m.fieldKind()}
        value={choice}
        choices={[
          { value: "expense", label: m.categoriesKindExpense() },
          { value: "income", label: m.categoriesKindIncome() },
          { value: "none", label: m.merchantDefaultNone() },
        ]}
        onChange={(next) => {
          setChoice(next);
          // A category of the other kind cannot be kept.
          setCategoryId(next === current?.kind && !current.archived ? current.id : null);
          setRefusal(NO_REFUSAL);
        }}
      />
      {choice === "none" ? null : (
        <CategoryPicker
          label={m.operationsCategory()}
          placeholder={m.categoriesSearch()}
          categories={tree === undefined ? [] : choicesOf(tree, choice)}
          value={categoryId}
          onValueChange={setCategoryId}
          error={refusal.field}
          required
        />
      )}
      <FormMessage message={refusal.form} />
    </FormDialog>
  );
}
