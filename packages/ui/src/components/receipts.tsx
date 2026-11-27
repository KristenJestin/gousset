import { AnimatePresence, domMax, LazyMotion, m } from "motion/react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { transition } from "../lib/motion";
import { Button } from "./button";
import { ButtonLink } from "./button-link";
import { AlertDialog, Dialog } from "./dialog";
import { FileButton } from "./file-button";
import { FormMessage } from "./form-message";
import { IconButton } from "./icon-button";
import { Skeleton, SkeletonFrame } from "./skeleton";
import { TextLink } from "./text-link";

// Receipts (#217): a photo or a PDF attached to a line, listed in its detail and on its subject's
// page, each to download.

/** A receipt, already worded. */
export type ReceiptView = {
  id: string;
  /** As the user named the file. */
  fileName: string;
  /** Where it downloads. */
  href: string;
  /** Under its name, already worded: "PDF · 1.2 MB", or its line's "CB GRAND HOTEL · Oct 6". */
  detail: string;
};

/** One receipt's row: its name, a link that downloads it, and what the page says under it. */
function ReceiptRow({ receipt, action }: { receipt: ReceiptView; action?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">
          <TextLink href={receipt.href} download={receipt.fileName}>
            {receipt.fileName}
          </TextLink>
        </span>
        <span className="truncate text-xs text-muted-foreground">{receipt.detail}</span>
      </div>
      {action === undefined ? null : <span className="flex shrink-0">{action}</span>}
    </div>
  );
}

export type LineReceiptsProps = {
  /** The line's receipts, the first attached first. */
  receipts: ReadonlyArray<ReceiptView>;
  /** The kinds a receipt may be, as `<input accept>` takes them: ".pdf,.jpg,.jpeg,.png,.heic". */
  accept: string;
  /** What the installation takes, already worded: "PDF, JPEG, PNG and HEIC, 50 MB at most." */
  hint: string;
  /**
   * Attaches the file chosen: answers the refusal to say in the dialog, worded by the page (it
   * names the limit passed), or nothing once attached, which closes the dialog.
   */
  onAttach: (file: File) => Promise<string | undefined>;
  /** Deletes a receipt once confirmed: false when refused (the page says why), and it comes back. */
  onDelete: (id: string) => Promise<boolean>;
};

/**
 * A line's receipts (#217), in its detail (`LineDetail`'s `receipts`): each a link that downloads
 * it, with its kind and size, and its delete button, which asks first (`AlertDialog`). "Attach a
 * receipt" opens a `Dialog` where the user chooses a file; a refusal (too large, of a kind the
 * installation does not take) is said in it, naming the limit, and the dialog stays open.
 *
 * Motion: a receipt deleted folds away, fading out in 200 ms (ease-out), the rows under it sliding
 * up; one attached fades in in 200 ms. The dialogs are `Dialog`'s (200 ms in, 150 ms out; from the
 * bottom on a phone). Cut under reduced motion.
 */
export function LineReceipts({ receipts, accept, hint, onAttach, onDelete }: LineReceiptsProps) {
  const messages = useUiMessages().receipts;
  const heading = useId();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  // The rows of the first render are drawn as they are (no style attribute in the server's
  // markup); only a receipt that comes after fades in.
  const [first] = useState(() => new Set(receipts.map((receipt) => receipt.id)));
  const shown = receipts.filter((receipt) => !gone.has(receipt.id));

  async function attach(file: File) {
    setSending(true);
    setError(undefined);

    const refusal = await onAttach(file);

    setSending(false);

    if (refusal === undefined) {
      setOpen(false);
    } else {
      setError(refusal);
    }
  }

  async function remove(id: string) {
    setGone((before) => new Set([...before, id]));

    if (!(await onDelete(id))) {
      setGone((before) => new Set([...before].filter((each) => each !== id)));
    }
  }

  return (
    <section
      aria-labelledby={heading}
      data-slot="line-receipts"
      className="flex flex-col gap-2 border-t pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={heading} className="text-sm font-medium text-foreground">
          {messages.title}
        </h3>
        <Button
          variant="secondary"
          size="sm"
          icon="add"
          onClick={() => {
            setError(undefined);
            setOpen(true);
          }}
        >
          {messages.attach}
        </Button>
      </div>
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">{messages.none}</p> : null}
      {/* Layout moves need Motion's `domMax` features, loaded here only. */}
      <LazyMotion features={domMax}>
        <ul aria-labelledby={heading} className="relative flex flex-col text-sm">
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((receipt) => (
              <m.li
                key={receipt.id}
                data-slot="line-receipt"
                layout="position"
                className="border-b bg-card last:border-b-0"
                {...(first.has(receipt.id)
                  ? {}
                  : { initial: { opacity: 0 }, animate: { opacity: 1 } })}
                exit={{ opacity: 0 }}
                transition={transition.base}
              >
                <ReceiptRow
                  receipt={receipt}
                  action={
                    <AlertDialog
                      trigger={
                        <IconButton
                          icon="delete"
                          size="sm"
                          label={messages.delete(receipt.fileName)}
                        />
                      }
                      title={messages.deleteTitle}
                      description={messages.deleteDescription(receipt.fileName)}
                      confirmLabel={messages.deleteConfirm}
                      destructive
                      onConfirm={() => remove(receipt.id)}
                    />
                  }
                />
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
      </LazyMotion>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!sending) {
            setOpen(next);
          }
        }}
        title={messages.attach}
        description={hint}
      >
        <div data-slot="receipt-attach" className="flex flex-col items-start gap-3">
          <FileButton accept={accept} icon="add" loading={sending} onFile={attach}>
            {messages.choose}
          </FileButton>
          <FormMessage message={error} />
        </div>
      </Dialog>
    </section>
  );
}

export type SubjectReceiptsProps = {
  /** Every receipt of its lines, its expenses' and its payback lines', by the lines' days. */
  receipts: ReadonlyArray<ReceiptView>;
  /** Where every receipt downloads, in one zip. */
  zipHref: string;
  /** What an empty list says, in the page's words. */
  emptyText: string;
};

/**
 * A subject's receipts (#217), on its page: each a link that downloads it, its line under it, and
 * "Download all", one zip of them. A receipt is attached and deleted from its line's detail.
 *
 * Motion: none of its own; `ButtonLink`'s hover (150 ms), cut under reduced motion.
 */
export function SubjectReceipts({ receipts, zipHref, emptyText }: SubjectReceiptsProps) {
  const messages = useUiMessages().receipts;

  if (receipts.length === 0) {
    return <p className="flex h-10 items-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div data-slot="subject-receipts" className="flex flex-col gap-3">
      <ul aria-label={messages.title} className="flex flex-col divide-y text-sm">
        {receipts.map((receipt) => (
          <li key={receipt.id} data-slot="subject-receipt">
            <ReceiptRow receipt={receipt} />
          </li>
        ))}
      </ul>
      <div className="flex">
        <ButtonLink href={zipHref} variant="secondary" size="sm" download>
          {messages.downloadAll}
        </ButtonLink>
      </div>
    </div>
  );
}

/** `SubjectReceipts` on its way: `rows` rows of the same height, and its button. */
export function SubjectReceiptsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y">
          {Array.from({ length: Math.max(1, rows) }, (_, index) => (
            <li key={index} className="flex min-h-12 flex-col justify-center gap-1.5 py-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </li>
          ))}
        </ul>
        <Skeleton className="h-8 w-28" />
      </div>
    </SkeletonFrame>
  );
}
