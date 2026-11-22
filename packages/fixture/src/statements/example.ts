import { frenchRibKey, ibanWithCheckDigits } from "./iban";
import type { Statement } from "./statement";

const BANK_CODE = "99999";
const BRANCH_CODE = "00001";
const ACCOUNT_NUMBER = "00012345678";
const RIB_KEY = frenchRibKey(BANK_CODE, BRANCH_CODE, ACCOUNT_NUMBER);

/**
 * One month of a made-up current account at a made-up bank, the same in every format: enough lines
 * for an import to read money in and out, a rent, a subscription and a refund.
 */
export const exampleStatement: Statement = {
  bank: { name: "Banque Exemple", bic: "BEXAFRPPXXX", code: BANK_CODE },
  account: {
    iban: ibanWithCheckDigits("FR", `${BANK_CODE}${BRANCH_CODE}${ACCOUNT_NUMBER}${RIB_KEY}`),
    number: ACCOUNT_NUMBER,
    holder: "Dominique Exemple",
    currency: "EUR",
  },
  from: "2026-10-01",
  to: "2026-10-31",
  openingBalanceMinor: 123_456,
  lines: [
    {
      bookedOn: "2026-10-02",
      amountMinor: 245_000,
      label: "VIR SEPA ACME CONSEIL SALAIRE OCTOBRE",
      reference: "EX2026100201",
    },
    {
      bookedOn: "2026-10-03",
      amountMinor: -420,
      label: "CB LE FOURNIL DES TILLEULS 02/10",
      reference: "EX2026100301",
    },
    {
      bookedOn: "2026-10-05",
      amountMinor: -85_000,
      label: "PRLV SEPA SCI DES GLYCINES LOYER",
      reference: "EX2026100501",
    },
    {
      bookedOn: "2026-10-09",
      amountMinor: -6237,
      label: "CB MARCHE DE LA PLACE & CIE 08/10",
      reference: "EX2026100901",
    },
    {
      bookedOn: "2026-10-15",
      amountMinor: -1299,
      label: "PRLV SEPA STREAMFLIX ABONNEMENT",
      reference: "EX2026101501",
    },
    {
      bookedOn: "2026-10-21",
      amountMinor: 3500,
      label: "VIR SEPA CAMILLE EXEMPLE REMBOURSEMENT",
      reference: "EX2026102101",
    },
  ],
};
