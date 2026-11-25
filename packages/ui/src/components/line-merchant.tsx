import { useState } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Icon } from "./icon";
import { cn } from "../lib/utils";
import { NameField } from "./name-field";

export type LineMerchantProps = {
  /** Who was paid, by name; `null` while nobody is known (an intermediary's line that asks). */
  merchant: string | null;
  /** The payment service the money went through ("PayPal"), by name; `null` for a direct payment. */
  intermediary: string | null;
  /** The line went through an intermediary and nobody says who was paid: it asks the user. */
  asks: boolean;
  /** The merchants' names the field suggests while typing. */
  merchants: ReadonlyArray<string>;
  /**
   * Assigns the merchant, by the name chosen or typed (trimmed; a new name is kept as typed, for
   * the server to make): true once assigned, which closes the dialog. A refusal is the page's to
   * word, in `error`.
   */
  onAssign: (name: string) => Promise<boolean>;
  /** A refusal of the last assignment, worded by the page, shown under the field. */
  error?: string;
};

/**
 * Who a line paid, in its detail (`LineDetail`'s `merchant`), as a "Merchant" row: the merchant
 * alone for a direct payment ("Greenmarket"); for a line paid through an intermediary (PayPal,
 * Lydia, SumUp…) whose merchant is known, the merchant, "through PayPal" under it, and "Change";
 * for one whose merchant nobody knows yet (`asks`), a notice framed in the accent colour, "Who
 * was really paid?", "Paid through PayPal", and "Choose the merchant". Either button opens a
 * `Dialog` holding a `NameField` (the merchants suggested, a new name kept as typed); its submit
 * is busy until `onAssign` settles, a refusal shows under the field and the dialog stays open;
 * closing it (Cancel, Escape, a press outside) changes nothing. Nothing shows for a line with no
 * merchant that does not ask.
 *
 * Focus: the dialog gives focus back to the button that opened it. "Choose the merchant" and
 * "Change" are one button, at one place in the tree, whose words and look follow the state: once a
 * merchant is assigned, the button that opened the dialog is still there, now "Change", and focus
 * lands on it.
 *
 * Motion: none of its own; the row does not animate. The dialog is `Dialog`'s: it fades and grows
 * in 200 ms, ease-out (on a phone it slides up from the bottom edge), and leaves the same way. Cut
 * under reduced motion.
 */
export function LineMerchant({
  merchant,
  intermediary,
  asks,
  merchants,
  onAssign,
  error,
}: LineMerchantProps) {
  const messages = useUiMessages();
  const words = messages.operations;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  if (!asks && merchant === null) {
    return null;
  }

  const openDialog = () => {
    // Each opening starts from the merchant the line has, or from nothing when it asks.
    setName(asks ? "" : (merchant ?? ""));
    setOpen(true);
  };

  const assign = async () => {
    const typed = name.trim();

    if (typed === "") {
      return;
    }

    setBusy(true);

    try {
      if (await onAssign(typed)) {
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const said = asks ? (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <span className="flex text-primary">
          <Icon name="merchant" size="sm" />
        </span>
        {words.merchantAsks}
      </p>
      {intermediary === null ? null : (
        <p className="text-muted-foreground">{words.merchantPaidThrough(intermediary)}</p>
      )}
    </div>
  ) : (
    <dl className="flex min-w-0 flex-1 items-center justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{words.merchant}</dt>
      <dd className="flex min-w-0 flex-col text-right">
        <span className="font-medium break-words text-foreground">{merchant}</span>
        {intermediary === null ? null : (
          <span className="text-xs text-muted-foreground">
            {words.merchantThrough(intermediary)}
          </span>
        )}
      </dd>
    </dl>
  );

  return (
    <div
      data-slot="line-merchant"
      data-state={asks ? "asks" : "known"}
      className={cn(
        "flex gap-3 text-sm",
        asks
          ? "flex-col rounded-md border border-primary bg-muted px-3 py-3"
          : "items-center justify-between",
      )}
    >
      {said}
      {/* One button in both states, so that the dialog gives focus back to it once assigned. */}
      <div className="flex shrink-0">
        {asks || intermediary !== null ? (
          <Button
            variant={asks ? undefined : "secondary"}
            size="sm"
            aria-label={asks ? undefined : words.merchantChangeLabel}
            onClick={openDialog}
          >
            {asks ? words.merchantChoose : words.merchantChange}
          </Button>
        ) : null}
      </div>
      <Dialog
        title={words.merchantTitle}
        description={
          intermediary === null
            ? words.merchantDescriptionPlain
            : words.merchantDescription(intermediary)
        }
        open={open}
        onOpenChange={setOpen}
        onSubmit={(event) => {
          event.preventDefault();
          void assign();
        }}
        actions={
          <Button type="submit" loading={busy}>
            {words.merchantAssign}
          </Button>
        }
      >
        <NameField
          label={words.merchant}
          description={words.merchantNew}
          placeholder={words.merchantPlaceholder}
          value={name}
          onValueChange={setName}
          suggestions={merchants}
          error={error}
          required
        />
      </Dialog>
    </div>
  );
}
