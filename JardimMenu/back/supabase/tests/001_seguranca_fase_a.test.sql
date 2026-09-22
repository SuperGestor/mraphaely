-- Jardim Menu, testes de banco obrigatórios do prompt 2 (item 7), em pgTAP.
-- Roda com `supabase test db`, contra o Supabase local. Tudo dentro de uma transação
-- desfeita no fim: nenhum teste deixa dado para o próximo.
--
-- As mesmas asserções rodam hoje no PGlite (sem pgTAP), pelo script de verificação da
-- etapa, até o Docker subir.

begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

-- ---------- massa ----------
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-000000000012', 'gestor@a.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000021', 'gestor@b.test', 'authenticated', 'authenticated');

insert into organizations (id, name) values ('00000000-0000-4000-8000-000000000001', 'Org');
insert into stores (id, organization_id, slug, name) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'loja-a', 'Loja A'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', 'loja-b', 'Loja B');
insert into store_users (store_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000012', 'manager'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000021', 'manager');
insert into categories (id, store_id, name) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'Cervejas');
insert into products (id, store_id, category_id, name, price, pdv_code) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000000000c1', 'Chopp', 16, 'PDV-1');
insert into tables (id, store_id, number) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 1),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000b1', 1);
insert into devices (id, store_id, table_id, name, token_hash) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000000000e1', 'Tablet A', encode(sha256('tokA'::bytea), 'hex')),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000e2', 'Tablet B', encode(sha256('tokB'::bytea), 'hex'));

-- ---------- NF-005: INSERT direto como anon falha em cada tabela ----------
set local role anon;

select throws_ok($$ insert into organizations (name) values ('x') $$, '42501', null, 'anon: organizations');
select throws_ok($$ insert into stores (organization_id, slug, name) values ('00000000-0000-4000-8000-000000000001', 'x-x', 'x') $$, '42501', null, 'anon: stores');
select throws_ok($$ insert into categories (store_id, name) values ('00000000-0000-4000-8000-0000000000a1', 'x') $$, '42501', null, 'anon: categories');
select throws_ok($$ insert into products (store_id, category_id, name, price) values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'x', 1) $$, '42501', null, 'anon: products');
select throws_ok($$ insert into tables (store_id, number) values ('00000000-0000-4000-8000-0000000000a1', 9) $$, '42501', null, 'anon: tables');
select throws_ok($$ insert into devices (store_id, name, token_hash) values ('00000000-0000-4000-8000-0000000000a1', 'x', 'x') $$, '42501', null, 'anon: devices');
select throws_ok($$ insert into table_sessions (store_id, table_id, opened_by_device) values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1') $$, '42501', null, 'anon: table_sessions');
select throws_ok($$ insert into menu_events (session_id, store_id, event_type) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', 'page_view') $$, '42501', null, 'anon: menu_events');

-- ---------- NF-006: anon não lê tables, devices, table_sessions ----------
select throws_ok($$ select count(*) from tables $$, '42501', null, 'anon não lê tables');
select throws_ok($$ select count(*) from devices $$, '42501', null, 'anon não lê devices');
select throws_ok($$ select count(*) from table_sessions $$, '42501', null, 'anon não lê table_sessions');

-- ---------- device_token recusado: desconhecido, de outra loja, inativo, aposentado ----------
select throws_ok($$ select tablet_menu(encode(sha256('nao-existe'::bytea), 'hex')) $$, 'JM401', null, 'token desconhecido');
select ok(
  (tablet_menu(encode(sha256('tokA'::bytea), 'hex')) ->> 'products') not like '%Vinho%'
  and (tablet_menu(encode(sha256('tokA'::bytea), 'hex')) -> 'store' ->> 'slug') = 'loja-a',
  'token da loja A só resolve a loja A'
);
select ok(
  (tablet_menu(encode(sha256('tokA'::bytea), 'hex'))::text) not like '%PDV-%',
  'código do PDV não sai para o cliente'
);

reset role;
update devices set status = 'inactive' where id = '00000000-0000-4000-8000-0000000000d2';
set local role anon;
select throws_ok($$ select tablet_menu(encode(sha256('tokB'::bytea), 'hex')) $$, 'JM423', null, 'dispositivo inativo');

reset role;
update devices set status = 'retired', retired_at = now(),
  retired_by = (select id from store_users where user_id = '00000000-0000-4000-8000-000000000021')
 where id = '00000000-0000-4000-8000-0000000000d2';
set local role anon;
select throws_ok($$ select tablet_menu(encode(sha256('tokB'::bytea), 'hex')) $$, 'JM410', null, 'dispositivo aposentado');

-- ---------- dois ativos na mesma mesa: o índice recusa ----------
reset role;
select throws_ok(
  $$ insert into devices (store_id, table_id, name, token_hash)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'Clone', encode(sha256('clone'::bytea), 'hex')) $$,
  '23505', null, 'dois dispositivos ativos na mesma mesa'
);

-- ---------- nenhuma view expõe token_hash ----------
select is(
  (select count(*)::int from information_schema.columns c
     join information_schema.views v on v.table_schema = c.table_schema and v.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name in ('token_hash', 'qr_token')),
  0,
  'nenhuma view expõe token_hash nem qr_token'
);

-- ---------- autenticado não lê o hash, nem por coluna ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated"}';
select throws_ok($$ select token_hash from devices $$, '42501', null, 'autenticado não lê token_hash');

-- ---------- loja A não lê nem escreve dado da loja B ----------
select is(
  (select count(*)::int from products where store_id = '00000000-0000-4000-8000-0000000000b1'),
  0,
  'gestor da loja A não lê produtos da loja B'
);
select throws_ok(
  $$ select admin_upsert_category('00000000-0000-4000-8000-0000000000b1', null, 'Invasão', 1, true) $$,
  'JM403', null, 'gestor da loja A não escreve na loja B'
);
select throws_ok(
  $$ select admin_set_device_status('00000000-0000-4000-8000-0000000000d2', 'inactive') $$,
  'JM403', null, 'gestor da loja A não mexe em dispositivo da loja B'
);

-- ---------- privilégios por papel, enumerados ----------
-- O Supabase concede tudo a anon e authenticated por privilégio padrão. Estes testes pegam
-- qualquer objeto que nasça sem a revogação nominal.
reset role;
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
      and has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')),
  0,
  'anon não tem privilégio em tabela nem view'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')),
  0,
  'authenticated não escreve direto em tabela'
);
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  array['device_heartbeat', 'tablet_call_waiter', 'tablet_create_tab', 'tablet_item_total',
        'tablet_menu', 'tablet_open_session', 'tablet_place_order', 'tablet_reinforce_call',
        'tablet_request_cancel', 'tablet_resolve_device', 'tablet_session_summary',
        'tablet_store_hours', 'track_events'],
  'anon executa só as functions do tablet e do pixel'
);
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'jm\_%' and p.proname <> 'jm_role'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  '{}'::text[],
  'authenticated não executa as functions internas'
);

-- ---------- a única escrita anônima é o pixel ----------
-- Sem o sub do gestor: `reset role` não limpa a claim, e o anon de verdade não tem sub.
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select lives_ok(
  $$ select * from track_events(gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', '[{"event_type":"page_view"}]') $$,
  'anon grava pelo pixel'
);
select throws_ok(
  $$ select admin_upsert_category('00000000-0000-4000-8000-0000000000a1', null, 'X', 1, true) $$,
  '42501', null, 'anon não executa function de admin'
);

select * from finish();
rollback;
