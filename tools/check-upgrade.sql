-- The rows tools/check-upgrade.sh puts into the last release, through the tables' owner, for what
-- that release offers no route to (0.1.1 has neither an accounts screen nor an import route): two
-- users' accounts, balances, an import with its file and lines, a CSV profile, and an MCP client
-- with its consent and tokens. The users themselves, their passwords and sessions come through the
-- app's own API. Every value is invented. Written for 0.1.1's schema: a release that changes these
-- tables, or offers a route for them, changes this file (docs/releases.md, "Every release is an
-- upgrade"). From 0.3.0 on, the counted lines are given their entries at the end, as 0.3.0's
-- migration gave them to the lines 0.2 kept.
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
  ('019a0000-0000-7000-8000-000000000303', :'camille', '019a0000-0000-7000-8000-000000000101', 'courant-septembre.csv', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'csv', '019a0000-0000-7000-8000-000000000001', null, 'done', '2026-09-01', '2026-09-30', 4, 4, 0, 0, null, '2026-10-02 09:00:00+00', '2026-10-02 09:00:02+00', null),
  ('019a0000-0000-7000-8000-000000000304', :'camille', '019a0000-0000-7000-8000-000000000106', 'livret-septembre.csv', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'csv', '019a0000-0000-7000-8000-000000000001', null, 'done', '2026-09-01', '2026-10-01', 5, 5, 0, 0, null, '2026-10-02 09:01:00+00', '2026-10-02 09:01:02+00', null);

insert into import_file (import_id, user_id, content)
values
  ('019a0000-0000-7000-8000-000000000301', :'camille', convert_to(E'Date;Libelle;Montant\n02/10/2026;CARTE BOULANGERIE EXEMPLE;-4,20\n05/10/2026;VIR SALAIRE EXEMPLE SA;2 150,00\n', 'UTF8')),
  ('019a0000-0000-7000-8000-000000000302', :'camille', '\x00ff10fe'::bytea),
  ('019a0000-0000-7000-8000-000000000303', :'camille', convert_to(E'Date;Libelle;Montant\n03/09/2026;VIR VERS LIVRET EXEMPLE;-200,00\n08/09/2026;VIR VERS LIVRET EXEMPLE;-75,00\n17/09/2026;VIR VERS LIVRET EXEMPLE;-150,00\n22/09/2026;VIR VERS LIVRET EXEMPLE;-40,00\n', 'UTF8')),
  ('019a0000-0000-7000-8000-000000000304', :'camille', convert_to(E'Date;Libelle;Montant\n04/09/2026;VIR DEPUIS COMPTE COURANT;200,00\n09/09/2026;VIR DEPUIS COMPTE COURANT;75,00\n10/09/2026;VIR DEPUIS COMPTE COURANT;75,00\n23/09/2026;VIR DEPUIS COMPTE COURANT;40,00\n01/10/2026;VIR DEPUIS COMPTE COURANT;150,00\n', 'UTF8'));

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
  -- Transfers between Camille's current account and her savings account, as 0.2 kept them: never
  -- paired, each line an expense or an income (#192). A clear pair, a day apart, each the other's
  -- only candidate; an ambiguous one, the money out with two candidates in; one across the
  -- savings account's fortnight (#131): out on the 17th, in at the next fortnight's start; and a
  -- clear pair whose money out Camille classified by hand from 0.3.0 on (below).
  ('019a0000-0000-7000-8000-000000000411', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000303', 'import', 'counted', '2026-09-03', null, -20000, null, null, 'VIR VERS LIVRET EXEMPLE', null, null, null, null, 'k-2026-09-03--20000-1', null, null, '2026-10-02 09:00:01+00', '2026-10-02 09:00:01+00'),
  ('019a0000-0000-7000-8000-000000000412', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000303', 'import', 'counted', '2026-09-08', null, -7500, null, null, 'VIR VERS LIVRET EXEMPLE', null, null, null, null, 'k-2026-09-08--7500-1', null, null, '2026-10-02 09:00:01+00', '2026-10-02 09:00:01+00'),
  ('019a0000-0000-7000-8000-000000000413', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000303', 'import', 'counted', '2026-09-17', null, -15000, null, null, 'VIR VERS LIVRET EXEMPLE', null, null, null, null, 'k-2026-09-17--15000-1', null, null, '2026-10-02 09:00:01+00', '2026-10-02 09:00:01+00'),
  ('019a0000-0000-7000-8000-000000000414', :'camille', '019a0000-0000-7000-8000-000000000101', '019a0000-0000-7000-8000-000000000303', 'import', 'counted', '2026-09-22', null, -4000, null, null, 'VIR VERS LIVRET EXEMPLE', null, null, null, null, 'k-2026-09-22--4000-1', null, null, '2026-10-02 09:00:01+00', '2026-10-02 09:00:01+00'),
  ('019a0000-0000-7000-8000-000000000421', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-09-04', null, 20000, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-09-04-20000-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00'),
  ('019a0000-0000-7000-8000-000000000422', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-09-09', null, 7500, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-09-09-7500-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00'),
  ('019a0000-0000-7000-8000-000000000423', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-09-10', null, 7500, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-09-10-7500-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00'),
  ('019a0000-0000-7000-8000-000000000425', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-09-23', null, 4000, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-09-23-4000-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00'),
  ('019a0000-0000-7000-8000-000000000424', :'camille', '019a0000-0000-7000-8000-000000000106', '019a0000-0000-7000-8000-000000000304', 'import', 'counted', '2026-10-01', null, 15000, null, null, 'VIR DEPUIS COMPTE COURANT', null, null, null, null, 'k-2026-10-01-15000-1', null, null, '2026-10-02 09:01:01+00', '2026-10-02 09:01:01+00');

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

-- From 0.3.0 on, every counted line with an amount has one entry (#23): the lines above get theirs as
-- 0.3.0's migration gave them to the lines 0.2 kept (`*_categories_isolation`): an expense or an
-- income in its kind's fallback, by default, with one payment part of the whole line. So a release
-- from 0.3.0 holds them as an installation updated from 0.2 holds its own: classified, and never
-- paired as transfers. A release before has no entry: the update's migration gives them. Then
-- Camille classifies one of her old transfer lines by hand, as 0.3.0 lets her: its expense goes to
-- the first top-level expense category of hers that is no fallback, by her (#192). The tables'
-- owner is a superuser here, which row-level security does not bind.
do $$
begin
  if to_regclass('public.entry') is not null then
    execute $entries$
      with pending as materialized (
        select uuidv7() as entry_id, l.user_id, l.id as line_id, l.booked_on,
          abs(l.amount_minor) as amount, c.id as category_id, c.kind
        from statement_line l
        join category c on c.user_id = l.user_id and c.is_fallback
          and c.kind = (case when l.amount_minor < 0 then 'expense' else 'income' end)::entry_kind
        where l.state = 'counted' and l.amount_minor <> 0
          and not exists (select 1 from entry_part p where p.line_id = l.id)
          and not exists (select 1 from transfer t where l.id in (t.out_line_id, t.in_line_id))
      ), made as (
        insert into entry (id, user_id, kind, happened_on, category_id, classified_by)
        select p.entry_id, p.user_id, p.kind, p.booked_on, p.category_id, 'default' from pending p
        returning id
      )
      insert into entry_part (user_id, entry_id, line_id, role, amount_minor)
      select p.user_id, p.entry_id, p.line_id, 'payment', p.amount from pending p
    $entries$;
    execute $by_hand$
      update entry e set classified_by = 'user', category_id = (
        select c.id from category c
        where c.user_id = e.user_id and c.kind = 'expense' and c.parent_id is null
          and not c.is_fallback
        order by c.position, c.id limit 1)
      from entry_part p
      where p.entry_id = e.id and p.line_id = '019a0000-0000-7000-8000-000000000414'
    $by_hand$;
  end if;
end
$$;

commit;
