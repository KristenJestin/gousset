import type { OperationRead } from "@gousset/core";
import type { OperationFormErrors, OperationFormValues } from "@gousset/ui/components/investments";

import type { OperationRefusalCode } from "@/functions/investments";

// Between the operation form (`OperationForm`, as typed) and the operation the server takes
// (`OperationInput`, docs/data-model.md, v0.6): the amount is typed without its sign, which the
// kind gives, and each kind sends only the fields it takes.

/** The kinds that take money out of the account: their amount is negative. */
const OUT: ReadonlySet<OperationFormValues["kind"]> = new Set(["purchase", "fee", "withdrawal"]);

const TRADES: ReadonlySet<OperationFormValues["kind"]> = new Set(["purchase", "sale"]);

/** A text typed, trimmed; null for nothing. */
const typed = (text: string) => {
  const trimmed = text.trim();

  return trimmed === "" ? null : trimmed;
};

/** The operation the form sends: its amount signed by its kind, the fields its kind takes. */
export function operationOf(values: OperationFormValues) {
  const amount = Math.abs(values.amountMinor ?? 0);
  const trade = TRADES.has(values.kind);
  const cash = values.kind === "deposit" || values.kind === "withdrawal";
  const withFees = trade || values.kind === "dividend";

  return {
    kind: values.kind,
    bookedOn: values.bookedOn,
    amountMinor: OUT.has(values.kind) && amount !== 0 ? -amount : amount,
    isin: cash ? null : typed(values.isin),
    securityName: trade ? typed(values.securityName) : null,
    quantity: trade ? values.quantity.trim() : null,
    unitPrice: trade ? values.unitPrice.trim() : null,
    feesMinor: withFees ? (values.feesMinor ?? 0) : 0,
  };
}

/** An operation read back into the form, to correct it: its amount without its sign. */
export function formValuesOf(
  operation: Pick<
    OperationRead,
    "kind" | "bookedOn" | "amount" | "fees" | "quantity" | "unitPrice" | "security"
  >,
): OperationFormValues {
  return {
    kind: operation.kind,
    bookedOn: operation.bookedOn,
    amountMinor: Math.abs(operation.amount.minor),
    isin: operation.security?.isin ?? "",
    securityName: operation.security?.name ?? "",
    quantity: operation.quantity ?? "",
    unitPrice: operation.unitPrice?.value ?? "",
    feesMinor: operation.fees.minor,
  };
}

/** A refusal as the server answers it. */
export type OperationRefusal = { readonly code: OperationRefusalCode; readonly text?: string };

/**
 * The field a refusal is said under: the one at fault, or the form itself. An invalid quantity is
 * the quantity's unless the text refused is the unit price's.
 */
export function refusalField(
  refusal: OperationRefusal,
  values: OperationFormValues,
): keyof OperationFormErrors {
  switch (refusal.code) {
    case "INVALID_ISIN":
    case "SECURITY_REQUIRED": {
      return "isin";
    }

    case "SIGN":
    case "AMOUNT": {
      return "amount";
    }

    case "FEES": {
      return "fees";
    }

    case "DAY": {
      return "bookedOn";
    }

    case "QUANTITY_REQUIRED": {
      return values.quantity.trim() === "" ? "quantity" : "unitPrice";
    }

    case "INVALID_QUANTITY": {
      return refusal.text === values.unitPrice.trim() && refusal.text !== values.quantity.trim()
        ? "unitPrice"
        : "quantity";
    }

    case "ACCOUNT_NOT_FOUND":
    case "NOT_AN_INVESTMENT_ACCOUNT":
    case "KEPT_BY_BALANCE":
    case "OPERATION_NOT_FOUND":
    case "QUANTITY_NOT_ALLOWED":
    case "SECURITY_NOT_ALLOWED":
    case "CURRENCY": {
      return "form";
    }
  }
}
