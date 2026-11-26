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
  ('019a0000-0000-7000-8000-000000000106', :'camille', 'Livret Exemple', 'savings', null, 'Banque Exemple', 'EUR', 'lines', 0, '2020-03-01', null, null, null, null, 'oldest_first', '2026-10-01 08:06:00+00', '2026-10-01 08:06:00+00'),
  ('019a0000-0000-7000-8000-000000000201', :'admin', 'Compte de l''administratrice', 'current', null, 'Autre Banque', 'EUR', 'lines', 0, null, null, 'DE39999999990012345678', null, null, 'oldest_first', '2026-10-01 08:05:00+00', '2026-10-01 08:05:00+00');

insert into import (id, user_id, account_id, file_name, file_sha256, format, profile_id, shipped_profile, status, period_from, period_to, lines_read, lines_added, lines_duplicate, lines_held, error_code, created_at, finished_at, undone_at)
values
  ('019a0000-0000-7000-8000-000000000301', :'camille', '019a0000-0000-7000-8000-000000000101', 'releve-octobre.csv', '5d41402abc4b2a76b9719d911017c592aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'csv', '019a0000-0000-7000-8000-000000000001', null, 'done', '2026-10-01', '2026-10-31', 4, 3, 0, 1, null, '2026-11-01 10:00:00+00', '2026-11-01 10:00:04+00', null),
  ('019a0000-0000-7000-8000-000000000302', :'camille', '019a0000-0000-7000-8000-000000000101', 'releve-septembre.ofx', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ofx', null, null, 'failed', null, null, 0, 0, 0, 0, 'unreadable', '2026-11-01 10:05:00+00', '2026-11-01 10:05:01+00', null),
  ('019a0000-0000-7000-8000-000000000303', :'camille', '019a0000-0000-7000-8000-000000000101', 'courant-septembre.csv', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'csv', '019a0000-0000-7000-8000-000000000001', null, 'done', '2026-09-01', '2026-09-30', 5, 5, 0, 0, null, '2026-10-02 09:00:00+00', '2026-10-02 09:00:02+00', null),
  ('019a0000-0000-7000-8000-000000000304', :'camille', '019a0000-0000-7000-8000-000000000106', 'livret-septembre.csv', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'csv', '019a0000-0000-7000-8000-000000000001', null, 'done', '2026-09-01', '2026-10-01', 6, 6, 0, 0, null, '2026-10-02 09:01:00+00', '2026-10-02 09:01:02+00', null);

insert into import_file (import_id, user_id, content)
values
  ('019a0000-0000-7000-8000-000000000301', :'camille', convert_to(E'Date;Libelle;Montant\n02/10/2026;CARTE BOULANGERIE EXEMPLE;-4,20\n05/10/2026;VIR SALAIRE EXEMPLE SA;2 150,00\n', 'UTF8')),
  ('019a0000-0000-7000-8000-000000000302', :'camille', '\x00ff10fe'::bytea),
  ('019a0000-0000-7000-8000-000000000303', :'camille', convert_to(E'Date;Libelle;Montant\n03/09/2026;VIR VERS LIVRET EXEMPLE;-200,00\n08/09/2026;VIR VERS LIVRET EXEMPLE;-75,00\n17/09/2026;VIR VERS LIVRET EXEMPLE;-150,00\n22/09/2026;VIR VERS LIVRET EXEMPLE;-40,00\n25/09/2026;VIR EPARGNE PROJET;-30,00\n', 'UTF8')),
  ('019a0000-0000-7000-8000-000000000304', :'camille', convert_to(E'Date;Libelle;Montant\n04/09/2026;VIR DEPUIS COMPTE COURANT;200,00\n09/09/2026;VIR DEPUIS COMPTE COURANT;75,00\n10/09/2026;VIR DEPUIS COMPTE COURANT;75,00\n23/09/2026;VIR DEPUIS COMPTE COURANT;40,00\n26/09/2026;VIR DEPUIS COMPTE COURANT;30,00\n01/10/2026;VIR DEPUIS COMPTE COURANT;150,00\n', 'UTF8'));

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
  ('019a0000-0000-7000-8000-000000000416', :'camille', '019a0000-0000-7000-8000-000000000101', null, 'manual', 'counted', '2026-10-07', null, 1500, null, null, 'CARD BRICOBOX EXEMPLE', null, null, null, null, null, null, null, '2026-11-02 18:06:00+00', '2026-11-02 18:06:00+00'),
  -- Transfers between Camille's current account and her savings account, as 0.2 kept them: never
  -- paired, each line an expense or an income (#192). A clear pair, a day apart, each the other's
  -- only candidate; an ambiguous one, the money out with two candidates in; one across the
  -- savings account's fortnight (#131): out on the 17th, in at the next fortnight's start; and two
  -- clear pairs whose money out Camille classified from 0.3.0 on (below), by hand and by a rule.
  ('019a0000-0000-7000-8000-000000000411', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000303', 'import', 'counted', '2026-09-03', null, -20000, null, null, 'VIR VERS LIVRET EXEMPLE', null, null, null, null, 'k-2026-09-03--20000-1', null, null, '2026-10-02 09:00:01+00', '2026-10-02 09:00:01+00'),
  ('019a0000-0000-7000-8000-000000000412', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000303', 'import', 'counted', '2026-09-08', null, -7500, null, null, 'VIR VERS LIVRET EXEMPLE', null, null, null, null, 'k-2026-09-08--7500-1', null, null, '2026-10-02 09:00:01+00', '2026-10-02 09:00:01+00'),
  ('019a0000-0000-7000-8000-000000000413', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000303', 'import', 'counted', '2026-09-17', null, -15000, null, null, 'VIR VERS LIVRET EXEMPLE', null, null, null, null, 'k-2026-09-17--15000-1', null, null, '2026-10-02 09:00:01+00', '2026-10-02 09:00:01+00'),
  ('019a0000-0000-7000-8000-000000000414', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000303', 'import', 'counted', '2026-09-22', null, -4000, null, null, 'VIR VERS LIVRET EXEMPLE', null, null, null, null, 'k-2026-09-22--4000-1', null, null, '2026-10-02 09:00:01+00', '2026-10-02 09:00:01+00'),
  ('019a0000-0000-7000-8000-000000000415', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000303', 'import', 'counted', '2026-09-25', null, -3000, null, null, 'VIR EPARGNE PROJET', null, null, null, null, 'k-2026-09-25--3000-1', null, null, '2026-10-02 09:00:01+00', '2026-10-02 09:00:01+00'),
  ('019a0000-0000-7000-8000-000000000421', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-09-04', null, 20000, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-09-04-20000-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00'),
  ('019a0000-0000-7000-8000-000000000422', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-09-09', null, 7500, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-09-09-7500-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00'),
  ('019a0000-0000-7000-8000-000000000423', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-09-10', null, 7500, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-09-10-7500-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00'),
  ('019a0000-0000-7000-8000-000000000425', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-09-23', null, 4000, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-09-23-4000-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00'),
  ('019a0000-0000-7000-8000-000000000426', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-09-26', null, 3000, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-09-26-3000-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00'),
  ('019a0000-0000-7000-8000-000000000424', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-10-01', null, 15000, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-10-01-15000-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00');

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
        ('019a0000-0000-7000-8000-000000000616', '019a0000-0000-7000-8000-000000000716', '019a0000-0000-7000-8000-000000000416', 'user'),
        ('019a0000-0000-7000-8000-000000000611', '019a0000-0000-7000-8000-000000000711', '019a0000-0000-7000-8000-000000000411', 'default'),
        ('019a0000-0000-7000-8000-000000000612', '019a0000-0000-7000-8000-000000000712', '019a0000-0000-7000-8000-000000000412', 'default'),
        ('019a0000-0000-7000-8000-000000000613', '019a0000-0000-7000-8000-000000000713', '019a0000-0000-7000-8000-000000000413', 'default'),
        ('019a0000-0000-7000-8000-000000000614', '019a0000-0000-7000-8000-000000000714', '019a0000-0000-7000-8000-000000000414', 'default'),
        ('019a0000-0000-7000-8000-000000000615', '019a0000-0000-7000-8000-000000000715', '019a0000-0000-7000-8000-000000000415', 'default'),
        ('019a0000-0000-7000-8000-000000000621', '019a0000-0000-7000-8000-000000000721', '019a0000-0000-7000-8000-000000000421', 'default'),
        ('019a0000-0000-7000-8000-000000000622', '019a0000-0000-7000-8000-000000000722', '019a0000-0000-7000-8000-000000000422', 'default'),
        ('019a0000-0000-7000-8000-000000000623', '019a0000-0000-7000-8000-000000000723', '019a0000-0000-7000-8000-000000000423', 'default'),
        ('019a0000-0000-7000-8000-000000000624', '019a0000-0000-7000-8000-000000000724', '019a0000-0000-7000-8000-000000000424', 'default'),
        ('019a0000-0000-7000-8000-000000000625', '019a0000-0000-7000-8000-000000000725', '019a0000-0000-7000-8000-000000000425', 'default'),
        ('019a0000-0000-7000-8000-000000000626', '019a0000-0000-7000-8000-000000000726', '019a0000-0000-7000-8000-000000000426', 'default')
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

-- Camille's old transfer lines (#192) have their entries from 0.3.0 on (above): classified by
-- default, never paired, as an installation updated from 0.2 holds them. Then she classifies two of
-- them, as 0.3.0 lets her: one by hand, the other by a rule she wrote and applied to the past; each
-- expense goes to the first top-level expense category of hers that is no fallback. Before 0.3.0
-- she could not. The tables' owner is a superuser here, which row-level security does not bind.
do $$
begin
  if to_regclass('public.entry_part') is not null then
    execute $by_hand$
      update entry e set classified_by = 'user', category_id = (
        select c.id from category c
        where c.user_id = e.user_id and c.kind = 'expense' and c.parent_id is null
          and not c.is_fallback
        order by c.position, c.id limit 1)
      from entry_part p
      where p.entry_id = e.id and p.line_id = '019a0000-0000-7000-8000-000000000414'
    $by_hand$;
    execute $by_rule$
      with written as (
        insert into rule (id, user_id, position, enabled, conditions, set_category_id, applied_count, created_from, created_at, updated_at)
        select '019a0000-0000-7000-8000-000000000801', l.user_id, 0, true,
          '{"kind": "group", "combinator": "and", "children": [{"kind": "rule", "field": "label", "operator": "contains", "value": "VIR EPARGNE"}]}',
          (select c.id from category c
            where c.user_id = l.user_id and c.kind = 'expense' and c.parent_id is null
              and not c.is_fallback
            order by c.position, c.id limit 1),
          1, 'user', '2026-11-25 09:00:00+00', '2026-11-25 09:00:00+00'
        from statement_line l where l.id = '019a0000-0000-7000-8000-000000000415'
        returning id, set_category_id
      )
      update entry e set classified_by = 'rule', rule_id = w.id, category_id = w.set_category_id
      from entry_part p, written w
      where p.entry_id = e.id and p.line_id = '019a0000-0000-7000-8000-000000000415'
    $by_rule$;
  end if;
end
$$;

-- From 0.3.0 on, every user has the default categories (#23). Camille made two of them hers: an icon
-- of her choosing on "Housing", and "Gifts received" renamed "Presents". The update gives the set's
-- icons and colours (#205) only to categories still the set's, never over a choice:
-- tools/check-upgrade.changes.json declares the set's rows with no icon, so these two must stay as
-- she left them. psql does not fill a variable inside $$, so Camille goes through a setting, the
-- one row-level security reads (docs/data-model.md, "Ownership and isolation").
select set_config('gousset.user_id', :'camille', true);

DO $$
BEGIN
  IF to_regclass('public.category') IS NOT NULL THEN
    UPDATE category SET icon = 'pets'
    WHERE user_id = current_setting('gousset.user_id') AND kind = 'expense' AND name = 'Housing'
      AND parent_id IS NULL;

    UPDATE category SET name = 'Presents'
    WHERE user_id = current_setting('gousset.user_id') AND kind = 'income' AND name = 'Gifts received'
      AND parent_id IS NULL;
  END IF;
END
$$;

commit;
