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
   the counterparty says.
3. **The operation prefix says what the line is** (#194, `operations.ts`), never who was paid. A
   prefix is matched whole at the label's start, followed by a space or the label's end, accents and
   case aside: `F` in `F COTISATION CARTE`, never in `FERNWOOD`; `VIR` in `VIR SEPA …`, never in
   `VIREMENT GRATUIT`. What each says of the merchant (`OPERATION_MERCHANT`):
   - **the rest names it**: a card payment (`CB`, `CARTE`), a card's cancellation (`ANN CARTE`, a
     refund at the same shop: `ANN CARTE SHOPLY 12/10` → `SHOPLY`, the key of the payment it
     cancels, so #27 proposes the link), a direct debit (`PRLV`). These prefixes are payment phrases
     too (rule 9), skipped before the name;
   - **only a named party can**: a transfer (`VIR`, `VIR SEPA`) names a merchant only through a
     party marker (rule 6: `VIR SEPA RECU /DE ACME CONSEIL` → `ACME CONSEIL`) or the counterparty's
     name the format gives. Its free text names no one: `VIR DE EPARGNE`, a move between one's own
     accounts, and `VIR SEPA ACME CONSEIL SALAIRE OCTOBRE` give none;
   - **nothing names it**, whatever the counterparty says: a loan's instalment (`ECH PRET`), a fee
     (`F`, `FRAIS`), interest (`INTERETS`), a cheque deposited (`REMISE CHEQUE`), a withdrawal
     (`RETRAIT`).

   A key that would start with a prefix naming no one (`CB F SHOPLY` → `F SHOPLY`) is none, so that
   a key read again gives itself. A merchant's own name is the user's words: no operation prefix is
   read in it (`nameKey`).

4. **One alphabet.** Upper case, accents removed (`PÂTISSERIE` → `PATISSERIE`, `Bäckerei` →
   `BACKEREI`), typographic apostrophes made `'`, `Œ` and `Æ` spelled out.
5. **Web addresses.** `WWW.` and `https://` go; a domain's ending (`.COM`, `.FR`, `.CO.UK`,
   `.IO`…) and the path after it end the name: `PIXELPLAY.COM/BILL` → `PIXELPLAY`.
6. **Structured transfers and direct debits.** The first field marker cuts the label: `/MOTIF`,
   `/REF`, `/LIB`, `ECH/`, `ID EMETTEUR/`, `MDT/`, `REF/`, `REF:`, `LIB:`, `MOTIF:`, and German
   `EREF+`, `MREF+`, `SVWZ+`… Before it, a party marker (`/DE`, `/FRM`, `/BEN`, `DE:`, `POUR:`,
   `FROM:`, `TO:`) says where the name starts: `VIR SEPA RECU /DE ACME CONSEIL /MOTIF SALAIRE` →
   `ACME CONSEIL`.
7. **Breaks.** These never name anyone, and each ends a name:
   - an amount with its currency (`23,40 EUR`, `EUR 23.40`), any decimal number;
   - a date (`21/10`, `21/10/26`, `21.10.2026`, `2026-10-21`, `21-10-2026`, `21 OCT`, `21OCT26`),
     a time (`10:15`);
   - a card number (`X1234`, `XXXX1234`, `4974XXXXXXXX1234`, `CB*4821`, `*1234`, `XXXX`), a store
     number (`#0423`);
   - any number of three digits or more (a `DDMM` date, a store number, a reference), and any word
     mixing letters and digits (`AB12CD34E`, `S386294`);
   - the separators `//`, `-` and `*`.
8. **Card processors.** `SQ *`, `TST*` and `SP *` stand before the shop's own name, so they are
   dropped: `SQ *CORNER CAFE` → `CORNER CAFE`. A **payment intermediary** is not a processor: in
   `PAYLINK *PIXELPLAY` the `*` ends the name and the key is `PAYLINK`: the intermediary is the
   label's merchant, marked as one (#30). Recognition marks a merchant it makes from a key equal,
   letters and digits only, to a known intermediary's name (`intermediaries.ts`: `PAYPAL`, `LYDIA`,
   `SUMUP`…; never a prefix, `LYDIA MARTIN` is a person), and the user marks any other. Who was
   paid is then set on the line's entry by hand, and a rule remembers it: its words run from the
   intermediary's name through the name after it (`CB PAYPAL *PIXELPLAY 21/10` → `PAYPAL
   *PIXELPLAY`, `ruleWords` in `rule-words.ts`), never the intermediary alone. When nothing after
   the intermediary's name names anyone (`CB PAYPAL`, `PAYPAL 21/10`), there are no words and no
   rule is proposed: any would match every line of the intermediary. Words after it that a key's
   end drops (rule 11: a legal form, a country) are the intermediary's own company, not who was
   paid: `PRLV SEPA PAYPAL EUROPE SARL` proposes none, and `PAYPAL EUROPE SARL *PIXELPLAY` looks
   past them to `PIXELPLAY`.
9. **What comes before the name** is skipped: payment words (`CB`, `CARTE`, `PAIEMENT PAR CARTE`,
   `PRLV SEPA`, `PRELEVEMENT EUROPEEN`, `VIR`, `VIREMENT INSTANTANE EMIS`, `CARD PAYMENT TO`,
   `DIRECT DEBIT`, `POS`, `CONTACTLESS`, `VISA DEBIT`, `BANCONTACT`, `KARTENZAHLUNG`,
   `SEPA-LASTSCHRIFT`, `UEBERWEISUNG`, `KAUF/DIENSTLEISTUNG`, `DOMICILIATION`…, the full list is
   `PAYMENT_PHRASES`, with rule 3's prefixes that let the rest name the merchant), breaks, numbers, and a small word standing just before a break (`DU 211026`,
   `VOM 21.10.2026`, `ON 21-10-2026`). So when the date comes first, the name is after it:
   `CARTE 21/10/26 GREENMARKET` → `GREENMARKET`.
10. **The name runs to the next break.** What follows a date, a store number or a card number is the
    place, and is dropped: `CB GREENMARKET 2110 RIVERTON` → `GREENMARKET`. It stops at
    `MAX_KEY_LENGTH` (100) characters too, on a whole word (a single longer word is cut): a key
    becomes a new merchant's name, which is at most as long, and a label of any length never
    makes a key too long for the unique indexes on names and cleaned labels.
11. **What ends a name is trimmed**, one word at a time, while more than one word is left: a
    country (`FR`, `GB`, `GBR`, `DE`, `US`…), a US state (`CA`, `NY`, `TX`…), a legal form (`SA`,
    `SAS`, `SARL`, `GMBH`, `& CO KG`, `LTD`, `LIMITED`, `INC`, `LLC`, `BV`, `SRL`, `& CIE`…), the
    small words before a date (`ON`, `LE`, `DU`…), and `CARD`, `CARTE`, `REF` left before a number.
12. Nothing left is no key: a label of only references gives none.

The steps run in this order, one after the other (`keyOf`, then `labelKey` and `merchantKey` for
rules 1 to 3): a step added later goes in its place in that order, and its rule here. A card
label's town (#193) is no step of the key: one label alone cannot tell it from a name's last word,
so the key keeps it, and the matching drops it (`towns.ts`, below).

### Adding a bank's prefixes

A bank's operation prefixes are one more list in `operations.ts` (as `FRENCH` is), joined into
`OPERATION_PREFIXES`, each prefix with the operation it says. A new kind of operation is one more
value of `Operation`, with what it says of the merchant in `OPERATION_MERCHANT`. Its invented
labels go in `labels.test.ts`: each prefix with a label of its own, and a name that starts with the
same letters left untouched.

### Known limits of the key

- **A town with no separator stays**: `CONTACTLESS CORNER CAFE RIVERTON` → `CORNER CAFE RIVERTON`.
  The matching below joins it to `CORNER CAFE` when that is known, or when the user's card labels
  show `RIVERTON` is a town ("A card label's town").
- **The free text of a direct debit, or of a transfer another bank's way, stays**: `PRLV SEPA
  STREAMFLIX ABONNEMENT` → `STREAMFLIX ABONNEMENT`, `SEPA TRF ACME CONSULTING SALARY` → `ACME
  CONSULTING SALARY`. Nothing tells a name's last word from a motive's first; the matching joins
  them when the short form is known. A `VIR` transfer's free text gives no key at all (rule 3).
- **Numbers inside a name are lost** when they have three digits or more, or are glued to letters
  (`7SEAS`, `CAFE 1928`), and a name that starts with a number loses it.
- **A short word at the end may be taken for a country, a state or a legal form**: `PLUG CO` →
  `PLUG`. The states that are common English words (`IN`, `OR`, `ME`, `OK`, `HI`, `OH`) are kept.
- **A name glued to its date** (`GREENMARKET2110`) is one reference word, so the label gives no
  key or another word's.
- **A word that is a payment word** at a name's start is dropped (`VISA`, `ACHAT`, `RETOUR`): a
  shop named that way loses its first word.
- **Any `ATM` or `BANCOMAT`** in a label makes it a withdrawal.
- **A prefix glued to what follows is no operation** (`CB*4821 SHOPLY`): the label is read as
  before, its key the same. **A shop whose name is a prefix naming no one** loses its key after a
  card's prefix (`CB FRAIS DE PORT EXPRESS`): the line gets no merchant, and its entry stays in
  its fallback category (the whole label is a card payment, no fee). The same goes at boot for a
  merchant a release before made that way and the user never touched (`PRLV SEPA FRAIS SCOLARITE
  ECOLE X`): it is forgotten (`reread.ts`). Only the prefixes of
  `operations.ts` are known: another bank's (`VIREMENT`, `PRELEVEMENT`) stay payment words (rule 9).

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

**A payment intermediary's keys match only by rule 1** (#30), never as a prefix either way: the
keys of a merchant marked as one (`KnownKey.intermediary`), a new key `isKnownIntermediary` names,
and every key of the merchant it makes in this run. So `LYDIA MARTIN`, a person paid by transfer,
gets a merchant "Lydia Martin" rather than joining Lydia, in one import or the next, and a new
`PAYPAL` never joins a merchant of `PAYPAL EUROPE`. A line is paid through the intermediary its
cleaned label's merchant is, so a prefix match would make it ask who was paid.

Keys are taken **shortest first** (fewest words, then alphabetically), and each key assigned is
known for the next ones. So in one import `CORNER CAFE` and `CORNER CAFE RIVERTON` become one
merchant named "Corner Cafe", and the result is the same whatever the order of the keys.

## A card label's town (`towns.ts`, #193)

A card payment's label often ends with the town where the card was used, so one shop's labels
differ by their last words: `CARTE X1234 03/10 PIZZA NOVA RIVERTON` and `CARTE X1234 17/10 PIZZA NOVA
LAKESIDE`. No list of towns can ship, and a bank may cut the town short at a fixed width (`CODEHUB
INC SAN FRANCI`). The user's own card labels tell the towns. `shopsOf` takes the keys of the card
payments' labels (`isCardPayment`: a label that starts with `CB`, `CARTE`, `ANN CARTE`, `PAIEMENT PAR
CARTE`, `CARD`, `CONTACTLESS`, `POS`, `VISA`, `KARTENZAHLUNG`…, as whole words) and gives each key
whose last words are a town its **shop**, the key without them:

1. **A key cut before its last words** can be a shop and its town when the words before have at
   least 4 letters or digits once their end is trimmed (rule 11, so `CODEHUB INC` is `CODEHUB`) and
   end on no small word, before the trim or after (an article, `LE`, `THE`; a preposition or a
   conjunction, `DU`, `DE`, `OF`, `ET`, `&`), and the last words start with no preposition and have
   at least 3 letters or digits, one a letter. So `CAFE DU PORT` is never `CAFE` in the town `PORT`.
2. **A town is known** when two shops were each paid in the same two places: `PIZZA NOVA RIVERTON`,
   `PIZZA NOVA LAKESIDE`, `FRESHMART RIVERTON`, `FRESHMART LAKESIDE` make `RIVERTON` and
   `LAKESIDE` towns. Or when a key ends with words doubled (`FRESHMART RIVERTON RIVERTON`), as some
   banks print it.
3. **A known town ends any card key** that can be a shop before it, the most words that can be:
   `PIZZA NOVA HILLCREST` stays whole until Hillcrest is known, `CORNER CAFE RIVERTON` is
   `CORNER CAFE` once Riverton is. A doubled town goes with both its copies.
4. **A town cut short** (`RIVERT`, `SAN FRANCI`), at least 4 letters or digits that start a known
   town, ends a key only after a shop another key shows in a whole town: `PIZZA NOVA RIVERT` is
   `PIZZA NOVA` when `PIZZA NOVA LAKESIDE` is one, `GREEN RIVER` is never `GREEN`.

The key keeps its town: it is the cleaned label that finds a line's merchant, so the aliases made
before still name their lines. `assignMerchants` takes the shops (`shopOf`): a key with a shop goes
first to the merchant whose key or shop is that shop, **compared whole** (letters and digits
only), then as any key; a new merchant is named after the shop ("Pizza Nova"). A shop is never a
prefix of another key: `BOULANGERIE` of `BOULANGERIE RIVERTON` never takes `BOULANGERIE DUPONT`. A
merchant's name that is the shop of its own cleaned labels compares whole as well (`whole`), so
that the merchant "Boulangerie" a town made does not take it either.

A name seen before more than 64 distinct last words shows no town (`MAX_PLACES`): it is the start
of other names or of references, and leaving it out keeps the reading linear in the keys.

The merchants a release made one per town, which the user never touched, are merged once per user
at boot (`town-merge.ts`; docs/data-model.md, v0.3, "The merchants made one per town are merged once
per user"), on the towns `sureShopsOf` is sure of: two shops each paid in the same two places, each
a place where at least three shops were paid, whole. None of the false towns below is one.

### Known limits of the town

- **A town nothing else shows stays**: one shop paid in two towns, with no other shop paid in both,
  keeps them (`PIZZA NOVA RIVERTON` and `PIZZA NOVA LAKESIDE` are two merchants): nothing tells
  them from two shops whose names share their first words. The user merges; a merchant named
  after the shop then takes the shop's labels in every town.
- **Two shops whose names differ in their last word**, each paid with another such pair
  (`CORNER CAFE`, `CORNER BAKERY`, `GRAND CAFE`, `GRAND BAKERY`), make `CAFE` and `BAKERY` towns for
  the labels recognised from then on. The user splits, and a split holds: the boot's merge never
  takes a merchant the user changed.
- **A doubled last word** is a town (`CAFE BORA BORA` is `CAFE` in `BORA`), and then ends any card
  key.
- **A town cut short** is found only after a shop seen in the whole town.
- **Only card payments' labels** show towns: a key only a transfer or a direct debit gives never
  loses its last words to one (`JEAN MARTIN`, a person paid, is never `JEAN`).

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
