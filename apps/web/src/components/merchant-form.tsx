import type { EntryKind, MerchantDetail, MerchantSummary } from "@gousset/core";
import type { Look, LookColor } from "@gousset/core/look";
import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { CategoryPicker } from "@gousset/ui/components/category-picker";
import { ColorSwatches } from "@gousset/ui/components/color-swatches";
import { FormMessage } from "@gousset/ui/components/form-message";
import { LogoField } from "@gousset/ui/components/logo-field";
import { SegmentedChoice } from "@gousset/ui/components/segmented-choice";
import { Sheet } from "@gousset/ui/components/sheet";
import { Switch } from "@gousset/ui/components/switch";
import { TextField } from "@gousset/ui/components/text-field";
import { TextListField } from "@gousset/ui/components/text-list-field";
import { automaticColorOf } from "@gousset/ui/lib/automatic-color";
import { notify } from "@gousset/ui/lib/notify";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createMerchant, editMerchant } from "@/functions/merchants";
import type { MerchantRefusalCode } from "@/functions/merchants";
import { merchantRefusalMessage } from "@/i18n/messages";
import { choicesOf } from "@/lib/categories";
import {
  logoFileRefusal,
  merchantLogoSrc,
  removeMerchantLogo,
  uploadMerchantLogo,
} from "@/lib/merchant-logo";
import type { LogoAnswer } from "@/lib/merchant-logo";
import { whileBusy } from "@/lib/while-busy";
import { categoryQueries } from "@/queries/categories";
import { invalidateMerchantEntries } from "@/queries/invalidate";

/** What the default category field offers first: a kind's categories, or none. */
type DefaultChoice = EntryKind | "none";

/** The logo as the form holds it: the saved one kept, a file picked to upload, or removed. */
type LogoChange =
  | { kind: "kept" }
  | { kind: "picked"; file: File; preview: string | undefined }
  | { kind: "removed" };

/** The default category to send: unchanged (left out), none or one (`id`), or one still to choose. */
type CategorySent =
  | { kind: "unchanged" }
  | { kind: "set"; id: string | null }
  | { kind: "missing" };

/** The merchant as saved: what an edit is told apart from, and its logo's address. */
type Saved = { id: string; name: string; intermediary: boolean; look: Look };

/** Where each refusal shows: under its field, or under the form. */
type Refusals = {
  name?: string;
  category?: string;
  labels?: string;
  logo?: string;
  form?: string;
};

/** A call that failed outright, as a refusal the form can show. */
type Failed = { ok: false; code: "UNKNOWN"; name: undefined; label: undefined };

const FAILED: Failed = { ok: false, code: "UNKNOWN", name: undefined, label: undefined };

/** A failed call answers a refusal: the React Compiler has no `try` to handle in a component. */
function answerOf<Answer>(call: Promise<Answer>): Promise<Answer | Failed> {
  return call.then(
    (answer) => answer,
    () => FAILED,
  );
}

/** A refusal of the merchant written, under the field it is about. */
function refusalsOf(
  answer: { code: MerchantRefusalCode | Failed["code"]; name?: string; label?: string },
  creating: boolean,
): Refusals {
  switch (answer.code) {
    case "NAME_TAKEN": {
      // Made by hand, a name taken is that merchant to open; renamed, the two are merged instead.
      return {
        name:
          creating && answer.name !== undefined
            ? m.merchantRefusalNameTakenNew({ name: answer.name })
            : merchantRefusalMessage(answer.code, answer.name),
      };
    }

    case "NAME_BLANK":
    case "NAME_TOO_LONG": {
      return { name: merchantRefusalMessage(answer.code) };
    }

    case "CATEGORY_NOT_FOUND":
    case "CATEGORY_ARCHIVED": {
      return { category: merchantRefusalMessage(answer.code) };
    }

    case "LABEL_NO_KEY":
    case "LABEL_TAKEN": {
      return { labels: merchantRefusalMessage(answer.code, answer.name, answer.label) };
    }

    default: {
      return { form: merchantRefusalMessage(answer.code, answer.name, answer.label) };
    }
  }
}

/** Uploads the logo picked, or removes the saved one; nothing for a logo kept. */
function writeLogo(merchantId: string, logo: LogoChange): Promise<LogoAnswer | undefined> {
  switch (logo.kind) {
    case "kept": {
      return Promise.resolve(undefined);
    }

    case "picked": {
      return uploadMerchantLogo(merchantId, logo.file);
    }

    case "removed": {
      return removeMerchantLogo(merchantId);
    }
  }
}

export type MerchantFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The merchant edited; left out, the form makes a new one. */
  merchant?: MerchantDetail;
  /** Called once the merchant and its logo are written, before the sheet closes. */
  onSaved?: (merchant: MerchantSummary, created: boolean) => void;
};

/**
 * A merchant made or edited by hand (#204), a long form in a side `Sheet` (docs/design.md, "Actions
 * and forms"; along the bottom edge on a phone): its name, its default category (none, or a kind
 * then a category in use of it), whether it is a payment intermediary, the labels that name it
 * (added; one comes off by moving it, on its page), its logo and its colour. Saving writes the
 * merchant, then uploads or removes its logo; a refusal shows under its field and the sheet stays
 * open. A merchant written whose logo is refused exists: the sheet becomes its edit, and says so
 * under the logo. Done, the merchants, the lines and the months are read again, a toast says so and
 * the sheet closes. `key` it at the call site by each opening, so that it starts afresh.
 *
 * Motion: none of its own; the shared `Sheet`'s, sliding in from its edge in 300 ms and out in
 * 200 ms over its backdrop, cut under reduced motion; the fields' own (the swatches' ring, the
 * category picker's list), cut likewise.
 */
export function MerchantForm({ open, onOpenChange, merchant, onSaved }: MerchantFormProps) {
  const queryClient = useQueryClient();
  const { data: tree } = useQuery(categoryQueries.list());
  const current = merchant?.defaultCategory ?? null;

  const [saved, setSaved] = useState<Saved | undefined>(
    merchant === undefined
      ? undefined
      : {
          id: merchant.id,
          name: merchant.name,
          intermediary: merchant.intermediary,
          look: merchant.look,
        },
  );

  const [name, setName] = useState(merchant?.name ?? "");
  const [choice, setChoice] = useState<DefaultChoice>(current?.kind ?? "none");

  // An archived category is shown on the page, never offered: the picker starts empty then.
  const [categoryId, setCategoryId] = useState(
    current === null || current.archived ? null : current.id,
  );

  // The category is sent only once changed: an archived one is kept until another is chosen.
  const [categoryChanged, setCategoryChanged] = useState(false);
  const [intermediary, setIntermediary] = useState(merchant?.intermediary ?? false);
  const [labels, setLabels] = useState<ReadonlyArray<string>>([]);
  const [color, setColor] = useState<LookColor | null>(merchant?.look.color ?? null);
  const [logo, setLogo] = useState<LogoChange>({ kind: "kept" });
  const [refusals, setRefusals] = useState<Refusals>({});
  const [busy, setBusy] = useState(false);

  const logoSrc =
    logo.kind === "picked"
      ? logo.preview
      : logo.kind === "removed" || saved === undefined
        ? undefined
        : merchantLogoSrc(saved.id, saved.look);

  const categoryToSend = (): CategorySent => {
    if (!categoryChanged) {
      return { kind: "unchanged" };
    }

    if (choice === "none") {
      return { kind: "set", id: null };
    }

    return categoryId === null ? { kind: "missing" } : { kind: "set", id: categoryId };
  };

  /** Writes the merchant: made the first time, edited with what changed afterwards. */
  const writeMerchant = (category: CategorySent) => {
    if (saved === undefined) {
      return answerOf(
        createMerchant({
          data: {
            name,
            defaultCategoryId: category.kind === "set" ? category.id : null,
            intermediary,
            color,
            labels: [...labels],
          },
        }),
      );
    }

    return answerOf(
      editMerchant({
        data: {
          merchantId: saved.id,
          name: name === saved.name ? undefined : name,
          defaultCategoryId: category.kind === "set" ? category.id : undefined,
          intermediary: intermediary === saved.intermediary ? undefined : intermediary,
          color: color === saved.look.color ? undefined : color,
          labels: labels.length === 0 ? undefined : [...labels],
        },
      }),
    );
  };

  async function save() {
    const category = categoryToSend();

    if (category.kind === "missing") {
      setRefusals({ category: m.merchantDefaultChoose() });

      return;
    }

    const creating = saved === undefined;

    const written = await whileBusy(setBusy, async () => {
      const answer = await writeMerchant(category);

      if (!answer.ok) {
        return { answer, logo: undefined };
      }

      return { answer, logo: await writeLogo(answer.merchant.id, logo) };
    });

    if (!written.answer.ok) {
      setRefusals(refusalsOf(written.answer, creating));

      return;
    }

    const { merchant: summary } = written.answer;

    // Written: what is saved is now the merchant's own, and the sheet edits it from here on.
    setCategoryChanged(false);
    setLabels([]);

    const look =
      written.logo !== undefined && "version" in written.logo
        ? { ...summary.look, logo: written.logo.version }
        : summary.look;

    setSaved({ id: summary.id, name: summary.name, intermediary: summary.intermediary, look });
    await invalidateMerchantEntries(queryClient);

    if (written.logo !== undefined && "refused" in written.logo) {
      setRefusals({
        logo: m.merchantFormLogoNotSaved({
          name: summary.name,
          reason: merchantRefusalMessage(written.logo.refused),
        }),
      });

      return;
    }

    setLogo({ kind: "kept" });
    setRefusals({});
    notify.saved({
      description: creating
        ? m.merchantCreated({ name: summary.name })
        : m.merchantSaved({ name: summary.name }),
    });
    onSaved?.({ ...summary, look }, creating);
    onOpenChange(false);
  }

  // A merchant made here whose logo was refused is edited from then on: it exists.
  const editing = saved !== undefined;

  return (
    <Sheet
      title={editing ? m.merchantFormEditTitle({ name: saved.name }) : m.merchantFormNewTitle()}
      description={editing ? undefined : m.merchantFormNewDescription()}
      open={open}
      onOpenChange={onOpenChange}
      // While the form is sent it stays open: its answer lands on the form that sent it.
      sending={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      actions={
        <Button type="submit" loading={busy}>
          {editing ? m.merchantFormSave() : m.merchantFormCreate()}
        </Button>
      }
    >
      <TextField
        label={m.fieldName()}
        placeholder={m.merchantNamePlaceholder()}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={refusals.name}
        autoComplete="off"
        required
      />
      <SegmentedChoice
        label={m.merchantDefaultTitle()}
        value={choice}
        choices={[
          { value: "expense", label: m.categoriesKindExpense() },
          { value: "income", label: m.categoriesKindIncome() },
          { value: "none", label: m.merchantDefaultNone() },
        ]}
        onChange={(next) => {
          setChoice(next);
          setCategoryChanged(true);
          // A category of the other kind cannot be kept.
          setCategoryId(next === current?.kind && !current.archived ? current.id : null);
          setRefusals({ ...refusals, category: undefined });
        }}
      />
      {choice === "none" ? (
        <FormMessage message={refusals.category} />
      ) : (
        <CategoryPicker
          label={m.operationsCategory()}
          placeholder={m.categoriesSearch()}
          categories={tree === undefined ? [] : choicesOf(tree, choice)}
          value={categoryId}
          onValueChange={(next) => {
            setCategoryId(next);
            setCategoryChanged(true);
          }}
          error={refusals.category}
          required
        />
      )}
      <Switch
        label={m.merchantIntermediary()}
        description={m.merchantIntermediaryDescription()}
        checked={intermediary}
        onCheckedChange={setIntermediary}
      />
      <TextListField
        label={m.merchantLabelsTitle()}
        description={
          editing ? m.merchantFormLabelsAddDescription() : m.merchantFormLabelsDescription()
        }
        placeholder={m.merchantFormLabelsPlaceholder()}
        values={labels}
        onChange={(next) => {
          setLabels(next);
          setRefusals({ ...refusals, labels: undefined });
        }}
        error={refusals.labels}
      />
      <LogoField
        label={m.merchantFormLogo()}
        name={name}
        color={color}
        src={logoSrc}
        description={m.merchantFormLogoDescription()}
        error={refusals.logo}
        disabled={busy}
        onFile={(file, preview) => {
          // Refused here before a byte is sent: the server would refuse it too.
          const refused = logoFileRefusal(file);

          if (refused === undefined) {
            setLogo({ kind: "picked", file, preview });
          }

          setRefusals({
            ...refusals,
            logo: refused === undefined ? undefined : merchantRefusalMessage(refused),
          });
        }}
        onRemove={() => {
          setLogo({ kind: "removed" });
          setRefusals({ ...refusals, logo: undefined });
        }}
      />
      <ColorSwatches
        label={m.merchantFormColor()}
        value={color}
        onChange={setColor}
        noneLabel={m.merchantFormColorAutomatic()}
        noneColor={automaticColorOf(name)}
      />
      <FormMessage message={refusals.form} />
    </Sheet>
  );
}
