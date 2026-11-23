-- #132: the OFX, QFX and CAMT.053 readers decoded entities once, so a bank that encodes its text
-- twice (`&amp;apos;`) left `&apos;` in the lines read before 0.2.1. The readers now decode until
-- no entity is left (packages/import/README.md, "What a reader returns"). This migration gives the
-- lines they already read the text they read now, and the dedup key the import computes from it,
-- so that importing the same file again finds them (docs/data-model.md, "Imports and
-- deduplication").
--
-- What it changes, on an imported line of an OFX, QFX or CAMT.053 import only (QIF, MT940 and CSV
-- have no entities, and a line entered by hand is the user's own text):
-- - `label`, `memo`, `counterparty_name` and `bank_id`: decoded until no entity is left;
-- - `dedup_key`: computed again as the import computes it (`dedupKeys`, packages/core), when it is
--   shown to have been made from the line: `bank:` and the bank id, or `content:` and the SHA-256 of
--   the booking date, the amount and the label, with the occurrence the line had in its file
--   (`#1`, `#2`), which decoding leaves as it was. A key made otherwise is kept.
-- - Nothing else: not `updated_at`, which says when the line was last changed in the app.
--
-- A line ends with the text and the key the fixed reader and the import give for the same file, or
-- is left as it is: where this cannot tell what the reader makes of the file, it changes nothing.
-- That is a line whose file holds a CDATA section (read as written, never decoded) or a comment
-- (around which XML text is decoded piece by piece); a line whose text holds a reference to NUL or
-- to a surrogate (the reader drops half a pair and joins a whole one); a line whose text, once
-- decoded, the reader would tidy (`cleanValue`: a line break, a control or direction character, a
-- space at an end, a value left empty for which the reader takes another field); a CAMT.053 line
-- whose memo decodes to its label (the reader then gives no memo); and a text nested more than ten
-- levels deep, which no bank writes, so that a crafted one costs ten passes and no more.
--
-- A collision: when the key computed again is already another line's in the account (the same
-- payment read from a file encoded once), or two lines' new keys are the same, the line keeps its
-- key and only its text is decoded; of two lines, the one made first takes the new key. No line is
-- merged, removed or added: a later import of the file finds the line under the other line's key,
-- or holds what it reads as a near duplicate for review, never counted twice.
--
-- Safe to run again: decoded text holds no entity left, so a second run changes nothing. The
-- tables' owner may be bound by row-level security (`FORCE ROW LEVEL SECURITY`, app_role), so the
-- lines are read user by user, `gousset.user_id` set, as the app reads them. The functions live in
-- `pg_temp`, this session's own schema, and go with it: the schema is left as it was. Characters
-- are written as escapes (`\x00a0`, Postgres's), never as themselves.

-- The character an entity's name stands for (`apos`, `#39`, `#x27`); `null` for no entity, which
-- stays as written; `''` for NUL or a surrogate, which the reader drops or pairs.
CREATE OR REPLACE FUNCTION pg_temp.gousset_entity_character(entity_name text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  digits text;
  code integer;
BEGIN
  IF left(entity_name, 1) <> '#' THEN
    RETURN CASE lower(entity_name)
      WHEN 'amp' THEN '&'
      WHEN 'lt' THEN '<'
      WHEN 'gt' THEN '>'
      WHEN 'quot' THEN '"'
      WHEN 'apos' THEN ''''
      WHEN 'nbsp' THEN chr(160)
    END;
  END IF;

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
  IF code IS NULL OR code > 1114111 THEN
    RETURN NULL;
  END IF;

  IF code = 0 OR code BETWEEN 55296 AND 57343 THEN
    RETURN '';
  END IF;

  RETURN chr(code);
END
$$;--> statement-breakpoint
-- `decodeEntities` (packages/import/src/text.ts): one level per pass, until a pass changes nothing,
-- which ends where the readers' single pass ends (entities never overlap). Each pass reads the text
-- once, its pieces and its entities each in one regular expression; ten passes at most. `null` for
-- a text the reader would read otherwise: NUL or a surrogate, more than ten levels.
CREATE OR REPLACE FUNCTION pg_temp.gousset_decode_entities(input text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  entity constant text := '&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);';
  decoded text := input;
  pass text;
  refused boolean;
BEGIN
  FOR level IN 1 .. 11 LOOP
    -- The text between entities, and each entity as written or decoded, in the text's order.
    SELECT
      string_agg(piece.text || coalesce(found.written, ''), '' ORDER BY piece.n),
      coalesce(bool_or(found.refused), false)
    INTO pass, refused
    FROM unnest(regexp_split_to_array(decoded, entity)) WITH ORDINALITY AS piece (text, n)
    LEFT JOIN (
      SELECT
        match.n,
        coalesce(decoded_as.character, '&' || match.parts[1] || ';') AS written,
        decoded_as.character = '' AS refused
      FROM regexp_matches(decoded, entity, 'g') WITH ORDINALITY AS match (parts, n)
      CROSS JOIN LATERAL (
        SELECT pg_temp.gousset_entity_character(match.parts[1]) AS character
      ) decoded_as
    ) found ON found.n = piece.n;

    IF refused THEN
      RETURN NULL;
    END IF;

    IF pass = decoded THEN
      RETURN decoded;
    END IF;

    decoded := pass;
  END LOOP;

  -- An eleventh pass still decoded something: more than ten levels.
  RETURN NULL;
END
$$;--> statement-breakpoint
-- `cleanValue` (packages/import/src/text.ts): a tab or a line break becomes a space, control and
-- direction characters go, and the ends are trimmed of what JavaScript's `trim` takes.
CREATE OR REPLACE FUNCTION pg_temp.gousset_clean_value(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(input, '[\t\n\v\f\r\x0085\x2028\x2029]', ' ', 'g'),
      '[\x0001-\x001f\x007f-\x009f\x061c\x200e\x200f\x202a-\x202e\x2066-\x2069]', '', 'g'
    ),
    '^[ \x00a0\x1680\x2000-\x200a\x202f\x205f\x3000\xfeff]+|[ \x00a0\x1680\x2000-\x200a\x202f\x205f\x3000\xfeff]+$',
    '', 'g'
  )
$$;--> statement-breakpoint
-- `keyLabel` (packages/core/src/imports/keys.ts): trimmed, each run of JavaScript's `\s` one space.
CREATE OR REPLACE FUNCTION pg_temp.gousset_key_label(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace(
    regexp_replace(
      input,
      '^[\t\n\v\f\r \x00a0\x1680\x2000-\x200a\x2028\x2029\x202f\x205f\x3000\xfeff]+|[\t\n\v\f\r \x00a0\x1680\x2000-\x200a\x2028\x2029\x202f\x205f\x3000\xfeff]+$',
      '', 'g'
    ),
    '[\t\n\v\f\r \x00a0\x1680\x2000-\x200a\x2028\x2029\x202f\x205f\x3000\xfeff]+', ' ', 'g'
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

    WITH readable AS MATERIALIZED (
      -- The imports whose file this reads as the readers do: no CDATA section, no comment.
      SELECT i.id, i.format
      FROM import i
      JOIN import_file f ON f.import_id = i.id AND f.user_id = i.user_id
      WHERE i.user_id = person
        AND i.format IN ('ofx', 'qfx', 'camt053')
        AND position(convert_to('<![CDATA[', 'UTF8') IN f.content) = 0
        AND position(convert_to('<!--', 'UTF8') IN f.content) = 0
    ),
    candidate AS (
      SELECT
        l.id, l.account_id, l.booked_on, l.amount_minor, l.label, l.memo, l.counterparty_name,
        l.bank_id, l.dedup_key, r.format,
        pg_temp.gousset_decode_entities(l.label) AS new_label,
        pg_temp.gousset_decode_entities(l.memo) AS new_memo,
        pg_temp.gousset_decode_entities(l.counterparty_name) AS new_counterparty_name,
        pg_temp.gousset_decode_entities(l.bank_id) AS new_bank_id
      FROM statement_line l
      JOIN readable r ON r.id = l.import_id
      WHERE l.user_id = person
        AND l.source = 'import'
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
      -- Left as it is: what the decoding refused (NUL, a surrogate, more than ten levels), what
      -- the reader would tidy once decoded, a CAMT.053 memo decoded to its label.
      WHERE c.new_label IS NOT NULL
        AND (c.memo IS NULL) = (c.new_memo IS NULL)
        AND (c.counterparty_name IS NULL) = (c.new_counterparty_name IS NULL)
        AND (c.bank_id IS NULL) = (c.new_bank_id IS NULL)
        AND pg_temp.gousset_clean_value(c.new_label) = c.new_label
        AND (c.new_memo IS NULL OR pg_temp.gousset_clean_value(c.new_memo) = c.new_memo)
        AND (
          c.new_counterparty_name IS NULL
          OR pg_temp.gousset_clean_value(c.new_counterparty_name) = c.new_counterparty_name
        )
        AND (c.new_bank_id IS NULL OR pg_temp.gousset_clean_value(c.new_bank_id) = c.new_bank_id)
        AND NOT (c.format = 'camt053' AND c.new_memo IS NOT NULL AND c.new_memo = c.new_label)
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
