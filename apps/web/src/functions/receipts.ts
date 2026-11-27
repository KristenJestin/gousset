import { deleteReceipt, subjectReceipts } from "@gousset/core";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { receiptLimits } from "@/receipts.server";
import { runCore } from "@/services";

import { signedIn, slowedInDevelopment } from "./month";
import { SubjectId } from "./subjects";

// The receipts' reads and deletion (#217), thin calls of `@gousset/core`'s: a receipt is attached
// and downloaded through the routes of `routes/api` (`lib/receipts.ts`), a line's are read with its
// detail. A refusal comes back as a code the page translates (`i18n/receipts.ts`).

const refused = (refused: "SUBJECT_NOT_FOUND" | "RECEIPT_NOT_FOUND") =>
  Effect.succeed({ ok: false as const, refusal: { refused } });

/** What the installation takes as a receipt: its size and its kinds, to refuse a file early. */
export const getReceiptLimits = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .handler(() => receiptLimits);

/** Every receipt of a subject's lines, its expenses' and its payback lines', by the lines' days. */
export const getSubjectReceipts = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ subjectId: SubjectId })))
  .handler(({ data, context }) =>
    runCore(
      subjectReceipts(context.owner, data.subjectId).pipe(
        Effect.map((receipts) => ({ ok: true as const, receipts })),
        Effect.catchTags({ SubjectNotFound: () => refused("SUBJECT_NOT_FOUND") }),
      ),
    ),
  );

/** Deletes one of the user's receipts, its file with it; one gone already is a code. */
export const removeReceipt = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ receiptId: Schema.String.check(Schema.isMaxLength(100)) }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      deleteReceipt(context.owner, data.receiptId).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({ ReceiptNotFound: () => refused("RECEIPT_NOT_FOUND") }),
      ),
    ),
  );
