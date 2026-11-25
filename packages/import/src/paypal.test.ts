import { csvSamples, paypalActivity } from "@gousset/fixture";
import { Effect, Exit } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { csvFile, matchCsvHeader, readCsv, testReadCsv } from "./csv";
import { SHIPPED_PROFILES, shippedProfile } from "./csv-shipped";

// PayPal's activity read as an account's statement (#201, docs/data-model.md, "PayPal's
// activity"), on invented exports (`@gousset/fixture`): the rows that moved the balance in the
// account's currency, each purchase named by its merchant, a payment in another currency by its
// conversion, with what it was in that currency.

const utf8 = new TextEncoder();

function paypal() {
  const found = shippedProfile("paypal-activity");

  if (found === undefined) {
    throw new Error("No PayPal profile is shipped.");
  }

  return found;
}

const read = (bytes: Uint8Array, currency = "EUR") =>
  Effect.runSync(readCsv(bytes, paypal().profile, { currency })).lines;

const matched = (bytes: Uint8Array) =>
  Effect.runSync(matchCsvHeader(csvFile(bytes), SHIPPED_PROFILES))?.key;

type Expected = {
  bookedOn: string;
  amountMinor: number;
  label: string;
  memo: string | null;
  bankId: string;
};

const line = ({ bookedOn, amountMinor, label, memo, bankId }: Expected) => ({
  bookedOn,
  valueOn: null,
  amountMinor,
  label,
  memo,
  bankId,
  counterparty: null,
});

/** The euro lines of the invented October, with the types named in `types`' language. */
function october(types: {
  checkout: string;
  bank: string;
  conversion: string;
  card: string;
  payment: string;
  refund: string;
}) {
  return [
    // A purchase, and the money the bank sent to pay it: two lines, the second a transfer's side.
    line({
      bookedOn: "2026-10-03",
      amountMinor: -1999,
      label: "Pixel Play Games",
      memo: types.checkout,
      bankId: "0PPEXAMPLE0000001",
    }),
    line({
      bookedOn: "2026-10-03",
      amountMinor: 1999,
      label: types.bank,
      memo: null,
      bankId: "0PPEXAMPLE0000002",
    }),
    // Paid in dollars: the euros its conversion took, named by who was paid, the dollars kept.
    {
      ...line({
        bookedOn: "2026-10-05",
        amountMinor: -2760,
        label: "Example Travel Ltd",
        memo: types.conversion,
        bankId: "0PPEXAMPLE0000005",
      }),
      original: { amountMinor: -3000, currency: "USD" },
    },
    line({
      bookedOn: "2026-10-05",
      amountMinor: 2760,
      label: types.card,
      memo: null,
      bankId: "0PPEXAMPLE0000006",
    }),
    // Money received, PayPal's fee taken: the net, as the balance moved.
    line({
      bookedOn: "2026-10-08",
      amountMinor: 4825,
      label: "Camille Example",
      memo: types.payment,
      bankId: "0PPEXAMPLE0000007",
    }),
    // Paid from the balance, then refunded to it.
    line({
      bookedOn: "2026-10-12",
      amountMinor: -1250,
      label: "Brightread Books",
      memo: types.checkout,
      bankId: "0PPEXAMPLE0000008",
    }),
    line({
      bookedOn: "2026-10-21",
      amountMinor: 1250,
      label: "Brightread Books",
      memo: types.refund,
      bankId: "0PPEXAMPLE0000009",
    }),
  ];
}

describe("PayPal's activity", () => {
  test("reads an English export: the euro rows completed, each purchase named by its merchant", () => {
    expect(read(paypalActivity.english.bytes)).toEqual(
      october({
        checkout: "Express Checkout Payment",
        bank: "Bank Deposit to PP Account",
        conversion: "General Currency Conversion",
        card: "General Card Deposit",
        payment: "General Payment",
        refund: "Payment Refund",
      }),
    );
  });

  test("reads a French export the same way, its columns and words in French", () => {
    expect(read(paypalActivity.french.bytes)).toEqual(
      october({
        checkout: "Paiement Express Checkout",
        bank: "Approvisionnement bancaire du compte PayPal",
        conversion: "Conversion de devise générale",
        card: "Approvisionnement général par carte",
        payment: "Paiement général",
        refund: "Remboursement de paiement",
      }),
    );
  });

  test("is recognised by its columns' names, in English or French, whichever are selected", () => {
    expect(matched(paypalActivity.english.bytes)).toBe("paypal-activity");
    expect(matched(paypalActivity.french.bytes)).toBe("paypal-activity");

    // The mandatory columns alone, in another order: still PayPal's.
    const fewer = utf8.encode(
      [
        '"Transaction ID","Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","To Email Address","Reference Txn ID","Receipt ID"',
        '"0PPEXAMPLE0000021","10/21/2026","10:00:00","PDT","Example Diner","Express Checkout Payment","Completed","USD","-1,234.50","0.00","-1,234.50","noa@example.com","diner@example.org","",""',
      ].join("\n"),
    );

    expect(matched(fewer)).toBe("paypal-activity");

    // Month first in this one: the 21st says so. A thousand grouped by a comma.
    expect(read(fewer, "USD")).toEqual([
      line({
        bookedOn: "2026-10-21",
        amountMinor: -123_450,
        label: "Example Diner",
        memo: "Express Checkout Payment",
        bankId: "0PPEXAMPLE0000021",
      }),
    ]);
  });

  test("reads days the file leaves ambiguous month first in English, day first in French", () => {
    const english = utf8.encode(
      [
        "Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net,From Email Address,To Email Address,Transaction ID,Reference Txn ID,Receipt ID",
        "10/02/2026,10:00:00,PDT,Example Diner,Express Checkout Payment,Completed,USD,-5.00,0.00,-5.00,,,0PPEXAMPLE0000031,,",
      ].join("\n"),
    );

    const french = utf8.encode(
      [
        "Date,Heure,Fuseau horaire,Nom,Type,État,Devise,Brut,Frais,Net,De l'adresse email,À l'adresse email,Numéro de transaction,Numéro de transaction de référence,Numéro de reçu",
        '10/02/2026,10:00:00,Europe/Paris,Exemple Bistrot,Paiement Express Checkout,Terminé,EUR,"-5,00","0,00","-5,00",,,0PPEXAMPLE0000032,,',
      ].join("\n"),
    );

    expect(read(english, "USD").map((each) => each.bookedOn)).toEqual(["2026-10-02"]);
    expect(read(french).map((each) => each.bookedOn)).toEqual(["2026-02-10"]);
  });

  test("into an account in dollars, reads the dollar rows: the purchase and its conversion", () => {
    expect(
      read(paypalActivity.english.bytes, "USD").map(({ amountMinor, label }) => ({
        amountMinor,
        label,
      })),
    ).toEqual([
      { amountMinor: -3000, label: "Example Travel Ltd" },
      { amountMinor: 3000, label: "General Currency Conversion" },
    ]);
  });

  test("passes a test read with no account chosen yet", () => {
    const passes = Exit.isSuccess(
      Effect.runSyncExit(
        testReadCsv(csvFile(paypalActivity.english.bytes), paypal().profile, null),
      ),
    );

    expect(passes).toBe(true);
  });

  test("is no other file's profile, and no other shipped profile reads its export", () => {
    for (const sample of Object.values(csvSamples)) {
      expect(matched(sample.bytes), sample.fileName).not.toBe("paypal-activity");
    }

    const others = SHIPPED_PROFILES.filter((each) => each.key !== "paypal-activity");

    expect(
      Effect.runSync(matchCsvHeader(csvFile(paypalActivity.english.bytes), others)),
    ).toBeUndefined();
  });
});
