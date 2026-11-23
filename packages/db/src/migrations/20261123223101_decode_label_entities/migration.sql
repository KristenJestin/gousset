-- #132: the OFX, QFX and CAMT.053 readers decoded entities once, so a bank that encodes its text
-- twice (`&amp;apos;`) left `&apos;` in the lines read before 0.2.1. The readers now decode until
-- no entity is left (packages/import/README.md, "What a reader returns"). This migration gives the
-- lines they already read the text they read now, and the dedup key the import computes from it,
-- so that importing the same file again finds them (docs/data-model.md, "Imports and
-- deduplication").
--
-- What it changes, on an imported line of an OFX, QFX or CAMT.053 import only (QIF, MT940 and CSV
-- have no entities, and a line entered by hand is the user's own text):
-- - `label`, `memo`, `counterparty_name` and `bank_id`: decoded until no entity is left, then tidied
--   as the readers tidy a value (`cleanValue`);
-- - `dedup_key`: computed again as the import computes it (`dedupKeys`, packages/core), when it is
--   shown to have been made from the line: `bank:` and the bank id, or `content:` and the SHA-256 of
--   the booking date, the amount and the label, with the occurrence the line had in its file
--   (`#1`, `#2`), which decoding leaves as it was. A key made otherwise is kept.
-- - Nothing else: not `updated_at`, which says when the line was last changed in the app.
--
-- A collision: when the key computed again is already another line's in the account (the same
-- payment read from a file encoded once), or two lines' new keys are the same, the line keeps its
-- key and only its text is decoded; of two lines, the one made first takes the new key. No line is
-- merged, removed or added: a later import of the file finds the line under the other line's key,
-- or holds what it reads as a near duplicate for review, never counted twice.
--
-- A line whose text holds an entity of a character Postgres cannot store (NUL, half a surrogate
-- pair), which the readers drop, or whose bank id decodes to nothing, is left as it is.
--
-- Safe to run again: decoded text holds no entity left, so a second run changes nothing. The
-- tables' owner may be bound by row-level security (`FORCE ROW LEVEL SECURITY`, app_role), so the
-- lines are read user by user, `gousset.user_id` set, as the app reads them. The functions live in
-- `pg_temp`, this session's own schema, and go with it: the schema is left as it was.

-- `decodeEntities` (packages/import/src/text.ts): one level per pass, until a pass changes nothing,
-- which ends where the readers' single pass ends. `null` for NUL or half a surrogate pair.
CREATE OR REPLACE FUNCTION pg_temp.gousset_decode_entities(input text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  decoded text := input;
  pass text;
  rest text;
  found text[];
  entity_name text;
  digits text;
  code integer;
  replacement text;
  found_at integer;
BEGIN
  LOOP
    pass := '';
    rest := decoded;

    LOOP
      found := regexp_match(rest, '&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);');
      EXIT WHEN found IS NULL;
      entity_name := found[1];
      -- The leftmost match is the first place its text stands: any earlier one would have matched.
      found_at := strpos(rest, '&' || entity_name || ';');
      replacement := NULL;

      IF left(entity_name, 1) <> '#' THEN
        replacement := CASE lower(entity_name)
          WHEN 'amp' THEN '&'
          WHEN 'lt' THEN '<'
          WHEN 'gt' THEN '>'
          WHEN 'quot' THEN '"'
          WHEN 'apos' THEN ''''
          WHEN 'nbsp' THEN chr(160)
        END;
      ELSE
        IF lower(left(entity_name, 2)) = '#x' THEN
          digits := ltrim(substr(entity_name, 3), '0');
          code := CASE WHEN length(digits) > 6 THEN NULL
            ELSE ('x' || lpad(digits, 8, '0'))::bit(32)::integer END;
        ELSE
          digits := ltrim(substr(entity_name, 2), '0');
          code := CASE WHEN length(digits) > 7 THEN NULL
            ELSE coalesce(nullif(digits, ''), '0')::integer END;
        END IF;

        -- Unicode's last code point, U+10FFFF: anything above is no character, and stays.
        IF code IS NOT NULL AND code <= 1114111 THEN
          IF code = 0 OR code BETWEEN 55296 AND 57343 THEN
            RETURN NULL;
          END IF;

          replacement := chr(code);
        END IF;
      END IF;

      pass := pass || left(rest, found_at - 1) || coalesce(replacement, '&' || entity_name || ';');
      rest := substr(rest, found_at + length(entity_name) + 2);
    END LOOP;

    pass := pass || rest;
    EXIT WHEN pass = decoded;
    decoded := pass;
  END LOOP;

  RETURN decoded;
END
$$;--> statement-breakpoint
-- `cleanValue` (packages/import/src/text.ts): a tab or a line break becomes a space, control and
-- direction characters go, and the ends are trimmed of what JavaScript's `trim` takes.
CREATE OR REPLACE FUNCTION pg_temp.gousset_clean_value(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(input, '[\t\n\v\f\r\u0085  ]', ' ', 'g'),
      '[\u0001-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]', '', 'g'
    ),
    '^[    -   　﻿]+|[    -   　﻿]+$',
    '', 'g'
  )
$$;--> statement-breakpoint
-- `keyLabel` (packages/core/src/imports/keys.ts): trimmed, each run of JavaScript's `\s` one space.
CREATE OR REPLACE FUNCTION pg_temp.gousset_key_label(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace(
    regexp_replace(
      input,
      '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$',
      '', 'g'
    ),
    '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'
  )
$$;--> statement-breakpoint
-- A content key without its occurrence (`dedupKeys`, packages/core/src/imports/keys.ts).
CREATE OR REPLACE FUNCTION pg_temp.gousset_content_key(booked_on date, amount_minor bigint, label text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT 'content:' || encode(sha256(convert_to(
    to_char(booked_on, 'YYYY-MM-DD') || chr(10) || amount_minor::text || chr(10)
      || pg_temp.gousset_key_label(label),
    'UTF8'
  )), 'hex')
$$;--> statement-breakpoint
DO $$
DECLARE
  person text;
  previous text := current_setting('gousset.user_id', true);
BEGIN
  FOR person IN SELECT id FROM auth_user ORDER BY id LOOP
    PERFORM set_config('gousset.user_id', person, true);

    WITH candidate AS (
      SELECT
        l.id, l.account_id, l.booked_on, l.amount_minor, l.label, l.memo, l.counterparty_name,
        l.bank_id, l.dedup_key,
        pg_temp.gousset_clean_value(pg_temp.gousset_decode_entities(l.label)) AS new_label,
        pg_temp.gousset_clean_value(pg_temp.gousset_decode_entities(l.memo)) AS new_memo,
        pg_temp.gousset_clean_value(pg_temp.gousset_decode_entities(l.counterparty_name))
          AS new_counterparty_name,
        pg_temp.gousset_clean_value(pg_temp.gousset_decode_entities(l.bank_id)) AS new_bank_id
      FROM statement_line l
      JOIN import i ON i.id = l.import_id AND i.user_id = l.user_id
      WHERE l.user_id = person
        AND l.source = 'import'
        AND i.format IN ('ofx', 'qfx', 'camt053')
        -- An entity holds no space: the four texts are looked through at once.
        AND concat_ws(' ', l.label, l.memo, l.counterparty_name, l.bank_id)
          ~ '&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);'
    ),
    decoded AS (
      SELECT
        c.*,
        CASE
          WHEN c.dedup_key = 'bank:' || c.bank_id THEN 'bank:' || c.new_bank_id
          WHEN c.dedup_key ~ '^content:[0-9a-f]{64}#[1-9][0-9]*$'
            AND split_part(c.dedup_key, '#', 1)
              = pg_temp.gousset_content_key(c.booked_on, c.amount_minor, c.label)
            THEN pg_temp.gousset_content_key(c.booked_on, c.amount_minor, c.new_label)
              || '#' || split_part(c.dedup_key, '#', 2)
          ELSE c.dedup_key
        END AS new_key
      FROM candidate c
      -- Left as it is: a text holding NUL or half a surrogate pair, a bank id decoded to nothing.
      WHERE c.new_label IS NOT NULL
        AND (c.memo IS NULL) = (c.new_memo IS NULL)
        AND (c.counterparty_name IS NULL) = (c.new_counterparty_name IS NULL)
        AND (c.bank_id IS NULL) = (c.new_bank_id IS NULL)
        AND (c.bank_id IS NULL OR c.bank_id = '' OR c.new_bank_id <> '')
        AND (c.label, c.memo, c.counterparty_name, c.bank_id)
          IS DISTINCT FROM (c.new_label, c.new_memo, c.new_counterparty_name, c.new_bank_id)
    ),
    ranked AS (
      SELECT d.*, row_number() OVER (PARTITION BY d.account_id, d.new_key ORDER BY d.id) AS turn
      FROM decoded d
    )
    UPDATE statement_line l
    SET
      label = r.new_label,
      memo = r.new_memo,
      counterparty_name = r.new_counterparty_name,
      bank_id = r.new_bank_id,
      -- A changed key had an entity in what it was made of, and a new one has none: a new key is
      -- never a key another changed line leaves, so the unique key holds at every row.
      dedup_key = CASE
        WHEN r.new_key = r.dedup_key THEN r.dedup_key
        WHEN r.turn = 1 AND NOT EXISTS (
          SELECT 1 FROM statement_line other
          WHERE other.account_id = r.account_id AND other.dedup_key = r.new_key
        ) THEN r.new_key
        ELSE r.dedup_key
      END
    FROM ranked r
    WHERE l.id = r.id AND l.user_id = person;
  END LOOP;

  PERFORM set_config('gousset.user_id', coalesce(previous, ''), true);
END
$$;
