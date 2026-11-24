# Merchants from raw labels

A bank never says "Greenmarket". It says `CB GREENMARKET 2110 RIVERTON`, `PAIEMENT PAR CARTE
GREENMARKET RIVERTON 21/10` or `SQ *GREENMARKET RIVERTON CA`, depending on the bank and the day.
`labels.ts` turns each label into a **key**, the words that name who was paid, and decides which
of the user's **merchants** each new key belongs to. Each key a merchant gets is saved as one of
its **aliases**, so the next import finds it at once.

It is pure: no database, no Effect. The tests in `labels.test.ts` are the contract: more than 70
invented labels in French, English, US, German, Belgian and Swiss styles, each with its key.

## A label's key (`merchantKey`)

A key is upper-case ASCII words separated by one space, made only of `A`–`Z`, `0`–`9`, `&` and
`'`. Reading a key again gives the same key.

1. **The counterparty first.** CAMT.053 and MT940 often give the other party's name apart from the
   label. When that name gives a key, it is the key; otherwise the label is read.
2. **Cash gives none.** `RETRAIT DAB`, `RETRAIT GAB`, `RETRAIT ESPECES`, `CASH WITHDRAWAL`, `ATM`,
   `BANCOMAT`, `GELDAUTOMAT`, `BARGELD…`: a withdrawal pays no one, so it has no merchant, whatever
   the counterparty says. Bank fees do keep a key (`FRAIS TENUE DE COMPTE`): the bank was paid.
3. **One alphabet.** Upper case, accents removed (`PÂTISSERIE` → `PATISSERIE`, `Bäckerei` →
   `BACKEREI`), typographic apostrophes made `'`, `Œ` and `Æ` spelled out.
4. **Web addresses.** `WWW.` and `https://` go; a domain's ending (`.COM`, `.FR`, `.CO.UK`,
   `.IO`…) and the path after it end the name: `PIXELPLAY.COM/BILL` → `PIXELPLAY`.
5. **Structured transfers and direct debits.** The first field marker cuts the label: `/MOTIF`,
   `/REF`, `/LIB`, `ECH/`, `ID EMETTEUR/`, `MDT/`, `REF/`, `REF:`, `LIB:`, `MOTIF:`, and German
   `EREF+`, `MREF+`, `SVWZ+`… Before it, a party marker (`/DE`, `/FRM`, `/BEN`, `DE:`, `POUR:`,
   `FROM:`, `TO:`) says where the name starts: `VIR SEPA RECU /DE ACME CONSEIL /MOTIF SALAIRE` →
   `ACME CONSEIL`.
6. **Breaks.** These never name anyone, and each ends a name:
   - an amount with its currency (`23,40 EUR`, `EUR 23.40`), any decimal number;
   - a date (`21/10`, `21/10/26`, `21.10.2026`, `2026-10-21`, `21-10-2026`, `21 OCT`, `21OCT26`),
     a time (`10:15`);
   - a card number (`X1234`, `XXXX1234`, `4974XXXXXXXX1234`, `CB*4821`, `*1234`, `XXXX`), a store
     number (`#0423`);
   - any number of three digits or more (a `DDMM` date, a store number, a reference), and any word
     mixing letters and digits (`AB12CD34E`, `S386294`);
   - the separators `//`, `-` and `*`.
7. **Card processors.** `SQ *`, `TST*` and `SP *` stand before the shop's own name, so they are
   dropped: `SQ *CORNER CAFE` → `CORNER CAFE`. A **payment intermediary** is not a processor: in
   `PAYLINK *PIXELPLAY` the `*` ends the name and the key is `PAYLINK`: the intermediary is the
   label's merchant, marked as one (#30). Recognition marks a merchant it makes from a key equal,
   letters and digits only, to a known intermediary's name (`intermediaries.ts`: `PAYPAL`, `LYDIA`,
   `SUMUP`…; never a prefix, `LYDIA MARTIN` is a person), and the user marks any other. Who was
   paid is then set on the line's entry by hand, and a rule remembers it: its words run from the
   intermediary's name through the name after it (`CB PAYPAL *PIXELPLAY 21/10` → `PAYPAL
   *PIXELPLAY`, `ruleWords` in `rule-words.ts`), never the intermediary alone.
8. **What comes before the name** is skipped: payment words (`CB`, `CARTE`, `PAIEMENT PAR CARTE`,
   `PRLV SEPA`, `PRELEVEMENT EUROPEEN`, `VIR`, `VIREMENT INSTANTANE EMIS`, `CARD PAYMENT TO`,
   `DIRECT DEBIT`, `POS`, `CONTACTLESS`, `VISA DEBIT`, `BANCONTACT`, `KARTENZAHLUNG`,
   `SEPA-LASTSCHRIFT`, `UEBERWEISUNG`, `KAUF/DIENSTLEISTUNG`, `DOMICILIATION`…, the full list is
   `PREFIXES`), breaks, numbers, and a small word standing just before a break (`DU 211026`,
   `VOM 21.10.2026`, `ON 21-10-2026`). So when the date comes first, the name is after it:
   `CARTE 21/10/26 GREENMARKET` → `GREENMARKET`.
9. **The name runs to the next break.** What follows a date, a store number or a card number is the
   place, and is dropped: `CB GREENMARKET 2110 RIVERTON` → `GREENMARKET`. It stops at
   `MAX_KEY_LENGTH` (100) characters too, on a whole word (a single longer word is cut): a key
   becomes a new merchant's name, which is at most as long, and a label of any length never
   makes a key too long for the unique indexes on names and cleaned labels.
10. **What ends a name is trimmed**, one word at a time, while more than one word is left: a
    country (`FR`, `GB`, `GBR`, `DE`, `US`…), a US state (`CA`, `NY`, `TX`…), a legal form (`SA`,
    `SAS`, `SARL`, `GMBH`, `& CO KG`, `LTD`, `LIMITED`, `INC`, `LLC`, `BV`, `SRL`, `& CIE`…), the
    small words before a date (`ON`, `LE`, `DU`…), and `CARD`, `CARTE`, `REF` left before a number.
11. Nothing left is no key: a label of only references gives none.

### Known limits of the key

- **A town with no separator stays**: `CONTACTLESS CORNER CAFE RIVERTON` → `CORNER CAFE RIVERTON`.
  The matching below joins it to `CORNER CAFE` when that is known.
- **The free text of a transfer stays**: `VIR SEPA ACME CONSEIL SALAIRE OCTOBRE` → `ACME CONSEIL
  SALAIRE OCTOBRE`, `PRLV SEPA STREAMFLIX ABONNEMENT` → `STREAMFLIX ABONNEMENT`. Nothing tells a
  name's last word from a motive's first; the matching joins them when the short form is known.
- **Numbers inside a name are lost** when they have three digits or more, or are glued to letters
  (`7SEAS`, `CAFE 1928`), and a name that starts with a number loses it.
- **A short word at the end may be taken for a country, a state or a legal form**: `PLUG CO` →
  `PLUG`. The states that are common English words (`IN`, `OR`, `ME`, `OK`, `HI`, `OH`) are kept.
- **A name glued to its date** (`GREENMARKET2110`) is one reference word, so the label gives no
  key or another word's.
- **A word that is a payment word** at a name's start is dropped (`VISA`, `ACHAT`, `RETOUR`): a
  shop named that way loses its first word.
- **Any `ATM` or `BANCOMAT`** in a label makes it a withdrawal.

## A new merchant's name (`merchantName`)

Each word is capitalised (`CORNER CAFE` → `Corner Cafe`), the letter after a one-letter elision
too (`L'ATELIER` → `L'Atelier`, `D'INTERVENTION` → `D'Intervention`). A word of four characters
at most with no vowel (`TLX`, `&`, `21`) stays as it is. Articles are capitalised like the rest
(`Marche De La Place`): the user renames when it reads wrong.

## A merchant's name as a key (`nameKey`)

A merchant also compares by its name, which the user may change: `nameKey` reads the name as a
label (`Corner Café` → `CORNER CAFE`, `Acme Widgets Ltd` → `ACME WIDGETS`), or, when that gives
nothing (`Visa`), upper-cases and cleans it the same way (`VISA`). A merchant named from a key
compares as that key.

## Which merchant a key goes to (`assignMerchants`)

It takes the new keys of an import and the keys already known (every alias and every merchant's
name key, with the merchant's id), and returns one assignment per distinct key: an existing
merchant by id, or a new one by name.

Keys compare in their **compact form**, letters and digits only, so `GREEN MARKET` is
`GREENMARKET` and `L ATELIER` is `L'ATELIER`. For each key:

1. **The same compact form** as a known key: that merchant. When several merchants have it, the
   smallest id, so that the choice never depends on order.
2. **The longest known key the new key starts with**, word by word (its first words, compacted,
   equal the known key), when that known key has at least 4 letters or digits: that merchant.
   `CORNER CAFE RIVERTON` goes to the merchant of `CORNER CAFE` rather than of `CORNER`. When two
   merchants tie on that longest start, the key gets a new merchant of its own: guessing would
   mix two shops.
3. **The new key starts the known keys of exactly one merchant**, and has at least 4 letters or
   digits: that merchant (`NORTHWIND` → the merchant of `NORTHWIND ENERGIE`).
4. Otherwise **a new merchant** named `merchantName(key)`. Two keys that give the same name get one
   merchant, as names are unique per user.

Keys are taken **shortest first** (fewest words, then alphabetically), and each key assigned is
known for the next ones. So in one import `CORNER CAFE` and `CORNER CAFE RIVERTON` become one
merchant named "Corner Cafe", and the result is the same whatever the order of the keys.

### Known limits of the matching, and how the user fixes them

- **Over-merging**: a short known key takes every longer key it starts: a merchant `CAFE` would
  take `CAFE DU PORT`. Four characters at least keeps `BAR` or `SCI` from doing it, not `CAFE`.
  The user **splits** by moving the wrong alias to another merchant (a new one if need be); the
  alias then stays there for every later import.
- **Under-merging**: two spellings that are not one the start of the other stay apart (`CORNER
  CAFE` and `THE CORNER CAFE`), and a key that starts the keys of two merchants gets a third. The user **merges** the two merchants; every alias then points to one.
- **A name that reads wrong** (`Elec Et Gaz Exemple`, `Acme Conseil Salaire Octobre`): the user
  **renames** the merchant; its new name key is known from then on, so a later label that spells
  the new name finds it.
