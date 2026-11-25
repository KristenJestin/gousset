-- The rows tools/check-upgrade.sh puts into the last release, through the tables' owner, for what
-- that release offers no route to (0.1.1 has neither an accounts screen nor an import route): two
-- users' accounts, balances, an import with its file and lines (with their entries, from 0.3.0), a
-- CSV profile, and an MCP client with its consent and tokens. The users themselves, their passwords and sessions come through the
-- app's own API. Every value is invented. Written for 0.1.1's schema: a release that changes these
-- tables, or offers a route for them, changes this file (docs/releases.md, "Every release is an
-- upgrade").
--   psql -v camille=<user id> -v admin=<user id> -f tools/check-upgrade.sql
\set ON_ERROR_STOP on

begin;

insert into import_profile (id, user_id, name, institution, kind, definition, header, created_at, updated_at)
values (
  '019a0000-0000-7000-8000-000000000001', :'camille', 'Banque Exemple CSV', 'Banque Exemple',
  'statement',
  '{"version": 1, "separator": ";", "columns": {"booked_on": 0, "label": 1, "amount": 2}, "date": "DD/MM/YYYY", "decimal": ","}',
  'Date;Libelle;Montant', '2026-10-01 08:00:00+00', '2026-10-02 09:30:00+00'
);

insert into account (id, user_id, name, kind, envelope, institution, currency, mode, opening_balance_minor, opened_on, closed_on, iban, number, settles_into_account_id, credit_order, created_at, updated_at)
values
  ('019a0000-0000-7000-8000-000000000101', :'camille', 'Compte courant', 'current', null, 'Banque Exemple', 'EUR', 'lines', 125043, '2019-04-01', null, 'FR7699999000010001234567809', null, null, 'oldest_first', '2026-10-01 08:00:00+00', '2026-10-01 08:00:00+00'),
  ('019a0000-0000-7000-8000-000000000102', :'camille', 'Carte à débit différé', 'card', null, 'Banque Exemple', 'EUR', 'lines', 0, null, null, null, '4970-XXXX-0042', '019a0000-0000-7000-8000-000000000101', 'oldest_first', '2026-10-01 08:01:00+00', '2026-10-01 08:01:00+00'),
  ('019a0000-0000-7000-8000-000000000103', :'camille', 'Livret A', 'savings', 'livret_a', 'Banque Exemple', 'EUR', 'balance', 0, '2015-01-10', null, null, null, null, 'oldest_first', '2026-10-01 08:02:00+00', '2026-10-01 08:02:00+00'),
  ('019a0000-0000-7000-8000-000000000104', :'camille', 'Titres-restaurant', 'benefit', null, 'Émetteur Exemple', 'EUR', 'lines', 0, null, null, null, null, null, 'expiring_first', '2026-10-01 08:03:00+00', '2026-10-01 08:03:00+00'),
  ('019a0000-0000-7000-8000-000000000105', :'camille', 'Compte à Tokyo', 'current', null, null, 'JPY', 'lines', 50000, null, '2026-06-30', null, null, null, 'oldest_first', '2026-10-01 08:04:00+00', '2026-10-01 08:04:00+00'),
  ('019a0000-0000-7000-8000-000000000201', :'admin', 'Compte de l''administratrice', 'current', null, 'Autre Banque', 'EUR', 'lines', 0, null, null, 'DE39999999990012345678', null, null, 'oldest_first', '2026-10-01 08:05:00+00', '2026-10-01 08:05:00+00');

insert into import (id, user_id, account_id, file_name, file_sha256, format, profile_id, shipped_profile, status, period_from, period_to, lines_read, lines_added, lines_duplicate, lines_held, error_code, created_at, finished_at, undone_at)
values
  ('019a0000-0000-7000-8000-000000000301', :'camille', '019a0000-0000-7000-8000-000000000101', 'releve-octobre.csv', '5d41402abc4b2a76b9719d911017c592aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'csv', '019a0000-0000-7000-8000-000000000001', null, 'done', '2026-10-01', '2026-10-31', 4, 3, 0, 1, null, '2026-11-01 10:00:00+00', '2026-11-01 10:00:04+00', null),
  ('019a0000-0000-7000-8000-000000000302', :'camille', '019a0000-0000-7000-8000-000000000101', 'releve-septembre.ofx', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ofx', null, null, 'failed', null, null, 0, 0, 0, 0, 'unreadable', '2026-11-01 10:05:00+00', '2026-11-01 10:05:01+00', null);

insert into import_file (import_id, user_id, content)
values
  ('019a0000-0000-7000-8000-000000000301', :'camille', convert_to(E'Date;Libelle;Montant\n02/10/2026;CARTE BOULANGERIE EXEMPLE;-4,20\n05/10/2026;VIR SALAIRE EXEMPLE SA;2 150,00\n', 'UTF8')),
  ('019a0000-0000-7000-8000-000000000302', :'camille', '\x00ff10fe'::bytea);

insert into statement_line (id, user_id, account_id, import_id, source, state, booked_on, value_on, amount_minor, original_amount_minor, original_currency, label, memo, counterparty_name, counterparty_iban, bank_id, dedup_key, duplicate_of_line_id, expires_on, created_at, updated_at)
values
  ('019a0000-0000-7000-8000-000000000401', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000301', 'import', 'counted', '2026-10-02', '2026-10-01', -420, null, null, 'CARTE BOULANGERIE EXEMPLE', null, null, null, null, 'k-2026-10-02--420-1', null, null, '2026-11-01 10:00:03+00', '2026-11-01 10:00:03+00'),
  ('019a0000-0000-7000-8000-000000000402', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000301', 'import', 'counted', '2026-10-05', null, 215000, null, null, 'VIR SALAIRE EXEMPLE SA', 'Salaire d''octobre', 'Exemple SA', 'DE39999999990012345678', 'B-0042', 'k-2026-10-05-215000-1', null, null, '2026-11-01 10:00:03+00', '2026-11-01 10:00:03+00'),
  ('019a0000-0000-7000-8000-000000000403', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000301', 'import', 'counted', '2026-10-12', null, -1999, -2300, 'USD', 'PAIEMENT EN LIGNE EXEMPLE', '=1+1 "quoted", line
two', null, null, null, 'k-2026-10-12--1999-1', null, null, '2026-11-01 10:00:03+00', '2026-11-01 10:00:03+00'),
  ('019a0000-0000-7000-8000-000000000404', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000301', 'import', 'held', '2026-10-12', null, -1999, null, null, 'PAIEMENT EN LIGNE EXEMPLE', null, null, null, null, 'k-2026-10-12--1999-2', '019a0000-0000-7000-8000-000000000403', null, '2026-11-01 10:00:03+00', '2026-11-01 10:00:03+00'),
  ('019a0000-0000-7000-8000-000000000405', :'camille', '019a0000-0000-7000-8000-000000000101', null, 'manual', 'discarded', '2026-10-20', null, -123456789012, null, null, 'Ligne saisie à la main', null, null, null, null, null, null, null, '2026-11-02 18:00:00+00', '2026-11-03 07:15:00.123456+00'),
  ('019a0000-0000-7000-8000-000000000406', :'camille', '019a0000-0000-7000-8000-000000000104', null, 'manual', 'counted', '2026-10-01', null, 18000, null, null, 'Crédit de titres-restaurant', null, null, null, null, null, null, '2027-12-31', '2026-11-02 18:01:00+00', '2026-11-02 18:01:00+00'),
  ('019a0000-0000-7000-8000-000000000407', :'admin', '019a0000-0000-7000-8000-000000000201', null, 'manual', 'counted', '2026-10-03', null, -5000, null, null, 'Ligne d''un autre utilisateur', null, null, null, null, null, null, null, '2026-11-02 18:02:00+00', '2026-11-02 18:02:00+00'),
  -- Two purchases, each with money coming back from the same shop a day later (#208): a refund
  -- Camille never answered, and one she classified by hand (below, from 0.3.0).
  ('019a0000-0000-7000-8000-000000000408', :'camille', '019a0000-0000-7000-8000-000000000101', null, 'manual', 'counted', '2026-10-03', null, -9000, null, null, 'CARD PIXELPLAY STORE', null, null, null, null, null, null, null, '2026-11-02 18:03:00+00', '2026-11-02 18:03:00+00'),
  ('019a0000-0000-7000-8000-000000000409', :'camille', '019a0000-0000-7000-8000-000000000101', null, 'manual', 'counted', '2026-10-04', null, 3000, null, null, 'CARD PIXELPLAY STORE', null, null, null, null, null, null, null, '2026-11-02 18:04:00+00', '2026-11-02 18:04:00+00'),
  ('019a0000-0000-7000-8000-000000000410', :'camille', '019a0000-0000-7000-8000-000000000101', null, 'manual', 'counted', '2026-10-06', null, -4500, null, null, 'CARD BRICOBOX EXEMPLE', null, null, null, null, null, null, null, '2026-11-02 18:05:00+00', '2026-11-02 18:05:00+00'),
  ('019a0000-0000-7000-8000-000000000411', :'camille', '019a0000-0000-7000-8000-000000000101', null, 'manual', 'counted', '2026-10-07', null, 1500, null, null, 'CARD BRICOBOX EXEMPLE', null, null, null, null, null, null, null, '2026-11-02 18:06:00+00', '2026-11-02 18:06:00+00');

-- From 0.3.0 on, packages/core writes a counted line with an amount together with its entry (#23;
-- docs/data-model.md, "Every counted line with an amount has exactly one entry"): an expense when
-- money leaves, an income when it comes in, the day it was booked, in its kind's fallback category,
-- `classified_by = default`, with one payment part of the whole line. Before 0.3.0 there is no
-- entry, and the update's migration gives each line its own. The money BRICOBOX sent back, Camille
-- put in its category by hand (`classified_by = user`), as she could from 0.3.0; the money
-- PIXELPLAY sent back she never answered, still where the import put it.
DO $$
BEGIN
  IF to_regclass('public.entry_part') IS NOT NULL THEN
    WITH given (entry_id, part_id, line_id, classified_by) AS (
      VALUES
        ('019a0000-0000-7000-8000-000000000601'::uuid, '019a0000-0000-7000-8000-000000000701'::uuid, '019a0000-0000-7000-8000-000000000401'::uuid, 'default'::classified_by),
        ('019a0000-0000-7000-8000-000000000602', '019a0000-0000-7000-8000-000000000702', '019a0000-0000-7000-8000-000000000402', 'default'),
        ('019a0000-0000-7000-8000-000000000603', '019a0000-0000-7000-8000-000000000703', '019a0000-0000-7000-8000-000000000403', 'default'),
        ('019a0000-0000-7000-8000-000000000606', '019a0000-0000-7000-8000-000000000706', '019a0000-0000-7000-8000-000000000406', 'default'),
        ('019a0000-0000-7000-8000-000000000607', '019a0000-0000-7000-8000-000000000707', '019a0000-0000-7000-8000-000000000407', 'default'),
        ('019a0000-0000-7000-8000-000000000608', '019a0000-0000-7000-8000-000000000708', '019a0000-0000-7000-8000-000000000408', 'default'),
        ('019a0000-0000-7000-8000-000000000609', '019a0000-0000-7000-8000-000000000709', '019a0000-0000-7000-8000-000000000409', 'default'),
        ('019a0000-0000-7000-8000-000000000610', '019a0000-0000-7000-8000-000000000710', '019a0000-0000-7000-8000-000000000410', 'default'),
        ('019a0000-0000-7000-8000-000000000611', '019a0000-0000-7000-8000-000000000711', '019a0000-0000-7000-8000-000000000411', 'user')
    ), pending AS MATERIALIZED (
      SELECT g.entry_id, g.part_id, g.classified_by, l.id AS line_id, l.user_id, l.booked_on,
        abs(l.amount_minor) AS amount, l.created_at, c.id AS category_id, c.kind
      FROM given g
      JOIN statement_line l ON l.id = g.line_id
      JOIN category c ON c.user_id = l.user_id AND c.is_fallback
        AND c.kind = (CASE WHEN l.amount_minor < 0 THEN 'expense' ELSE 'income' END)::entry_kind
    ), made AS (
      INSERT INTO entry (id, user_id, kind, happened_on, category_id, classified_by, created_at, updated_at)
      SELECT p.entry_id, p.user_id, p.kind, p.booked_on, p.category_id, p.classified_by, p.created_at, p.created_at
      FROM pending p
      RETURNING id
    )
    INSERT INTO entry_part (id, user_id, entry_id, line_id, role, amount_minor)
    SELECT p.part_id, p.user_id, p.entry_id, p.line_id, 'payment', p.amount FROM pending p;
  END IF;
END
$$;

insert into account_balance (id, user_id, account_id, day, balance_minor, source, import_id)
values
  ('019a0000-0000-7000-8000-000000000501', :'camille', '019a0000-0000-7000-8000-000000000101', '2026-09-30', 125043, 'statement', '019a0000-0000-7000-8000-000000000301'),
  ('019a0000-0000-7000-8000-000000000502', :'camille', '019a0000-0000-7000-8000-000000000101', '2026-10-31', 334624, 'statement', '019a0000-0000-7000-8000-000000000301'),
  ('019a0000-0000-7000-8000-000000000503', :'camille', '019a0000-0000-7000-8000-000000000103', '2026-10-31', 1230000, 'noted', null);

-- An MCP client Camille allowed, with its tokens, as the MCP door writes them (docs/mcp.md).
insert into auth_oauth_client (id, client_id, disabled, skip_consent, scopes, user_id, created_at, updated_at, name, uri, redirect_uris, token_endpoint_auth_method, grant_types, response_types, require_pkce, metadata)
values ('mcp-client-1', 'https://agent.example.com/oauth/client.json', false, false, '{gousset:read,gousset:write,offline_access}', null, '2026-11-04 09:00:00', '2026-11-04 09:00:00', 'Agent Exemple', 'https://agent.example.com', '{http://127.0.0.1:33418/callback}', 'none', '{authorization_code,refresh_token}', '{code}', true, '{"origin": "metadata-document"}');

insert into auth_oauth_consent (id, client_id, user_id, scopes, created_at, updated_at)
values ('mcp-consent-1', 'https://agent.example.com/oauth/client.json', :'camille', '{gousset:read,gousset:write,offline_access}', '2026-11-04 09:00:05', '2026-11-04 09:00:05');

insert into auth_oauth_refresh_token (id, token, client_id, user_id, resources, expires_at, created_at, scopes)
values ('mcp-refresh-1', 'invented-refresh-token-hash', 'https://agent.example.com/oauth/client.json', :'camille', '{http://localhost/mcp}', '2026-12-04 09:00:05', '2026-11-04 09:00:05', '{gousset:read,gousset:write,offline_access}');

insert into auth_oauth_access_token (id, token, client_id, user_id, resources, refresh_id, expires_at, created_at, scopes)
values ('mcp-access-1', 'invented-access-token-hash', 'https://agent.example.com/oauth/client.json', :'camille', '{http://localhost/mcp}', 'mcp-refresh-1', '2026-11-04 10:00:05', '2026-11-04 09:00:05', '{gousset:read,gousset:write}');

commit;
