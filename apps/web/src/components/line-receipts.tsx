import type { Receipt } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { LineReceipts } from "@gousset/ui/components/receipts";
import { notify } from "@gousset/ui/lib/notify";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { removeReceipt } from "@/functions/receipts";
import { receiptAccept, receiptHint, receiptRefusalMessage, receiptSize } from "@/i18n/receipts";
import { receiptPath, uploadReceipt } from "@/lib/receipts";
import { invalidateReceipts, receiptQueries } from "@/queries/receipts";

/**
 * The open line's receipts (#217), in its detail: listed with the line, each to download or delete;
 * a file attached through the upload route, refused early when over the installation's limit. Once
 * one is attached or deleted, the line and every subject's receipts are read again.
 */
export function LineReceiptsOf({
  lineId,
  receipts,
}: {
  lineId: string;
  receipts: ReadonlyArray<Receipt>;
}) {
  const queryClient = useQueryClient();
  const { data: limits } = useQuery(receiptQueries.limits());

  if (limits === undefined) {
    return null;
  }

  const known = limits;

  async function attach(file: File): Promise<string | undefined> {
    const answer = await uploadReceipt(file, lineId, known);

    if ("refused" in answer) {
      return receiptRefusalMessage(answer);
    }

    notify.saved({ description: m.receiptsAttached({ name: answer.receipt.fileName }) });
    await invalidateReceipts(queryClient);

    return undefined;
  }

  async function remove(receiptId: string): Promise<boolean> {
    const gone = receipts.find((receipt) => receipt.id === receiptId);

    const answer = await removeReceipt({ data: { receiptId } }).catch(() => ({
      ok: false as const,
      refusal: { refused: "RECEIPT_UNAVAILABLE" as const },
    }));

    if (!answer.ok) {
      notify.failed({ description: receiptRefusalMessage(answer.refusal) });

      return false;
    }

    notify.saved({ description: m.receiptsDeleted({ name: gone?.fileName ?? "" }) });
    await invalidateReceipts(queryClient);

    return true;
  }

  return (
    <LineReceipts
      receipts={receipts.map((receipt) => ({
        id: receipt.id,
        fileName: receipt.fileName,
        href: receiptPath(receipt.id),
        detail: receiptSize(receipt),
      }))}
      accept={receiptAccept(known)}
      hint={receiptHint(known)}
      onAttach={attach}
      onDelete={remove}
    />
  );
}
