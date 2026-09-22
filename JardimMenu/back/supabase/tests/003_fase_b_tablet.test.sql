-- Jardim Menu, Fase B, caminho do tablet (prompt 3): abertura de mesa, comanda, pedido,
-- recusas do JM-100 com código próprio (é o E2E-15, verificado na function do banco),
-- idempotência (JM-032, T5), número do turno (JM-036), cancelamento pedido pelo cliente,
-- chamado de garçom, resumo e heartbeat. Tudo numa transação desfeita no fim.

begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

-- ---------- apoio ----------
create function pg_temp.h(t text) returns text language sql immutable
as $$ select encode(sha256(t::bytea), 'hex') $$;

create temp table ids (k text primary key, v uuid);
create temp table res (k text primary key, j jsonb);
grant all on ids, res to anon, authenticated;

-- ---------- massa ----------
insert into auth.users (id, email, aud, role)
values ('00000000-0000-4000-8000-000000000301', 'dono@fb.test', 'authenticated', 'authenticated');
insert into organizations (id, name) values ('00000000-0000-4000-8000-000000000300', 'Org FB');
insert into stores (id, organization_id, slug, name) values
  ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-000000000300', 'loja-fb-a', 'Loja A'),
  ('00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-000000000300', 'loja-fb-b', 'Loja B');
insert into store_users (id, store_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-000000000301', 'owner');
insert into categories (id, store_id, name) values
  ('00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-0000000003a1', 'Pratos'),
  ('00000000-0000-4000-8000-0000000003d2', '00000000-0000-4000-8000-0000000003b1', 'Vinhos');
insert into products (id, store_id, category_id, name, price) values
  ('00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003d1', 'Burger', 10),
  ('00000000-0000-4000-8000-0000000003f2', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003d1', 'Chopp', 5),
  ('00000000-0000-4000-8000-0000000003f4', '00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000003d2', 'Vinho', 20);
insert into products (id, store_id, category_id, name, price, is_available, unavailable_since, unavailable_by) values
  ('00000000-0000-4000-8000-0000000003f3', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003d1',
   'Esgotado', 7, false, now(), '00000000-0000-4000-8000-0000000003c1');
insert into option_groups (id, store_id, name, min_select, max_select) values
  ('00000000-0000-4000-8000-000000000391', '00000000-0000-4000-8000-0000000003a1', 'Ponto', 1, 1),
  ('00000000-0000-4000-8000-000000000392', '00000000-0000-4000-8000-0000000003a1', 'Extras', 0, 2);
insert into options (id, group_id, name, price_delta, is_available) values
  ('00000000-0000-4000-8000-000000000381', '00000000-0000-4000-8000-000000000391', 'Ao ponto', 0, true),
  ('00000000-0000-4000-8000-000000000382', '00000000-0000-4000-8000-000000000391', 'Bem passado', 2, true),
  ('00000000-0000-4000-8000-000000000383', '00000000-0000-4000-8000-000000000392', 'Bacon', 1.5, true),
  ('00000000-0000-4000-8000-000000000384', '00000000-0000-4000-8000-000000000392', 'Ovo', 1, false);
insert into product_option_groups (product_id, group_id) values
  ('00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-000000000391'),
  ('00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-000000000392');
insert into tables (id, store_id, number) values
  ('00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003a1', 1),
  ('00000000-0000-4000-8000-0000000003e2', '00000000-0000-4000-8000-0000000003a1', 2),
  ('00000000-0000-4000-8000-0000000003e3', '00000000-0000-4000-8000-0000000003a1', 3),
  ('00000000-0000-4000-8000-0000000003e4', '00000000-0000-4000-8000-0000000003b1', 1);
insert into devices (id, store_id, table_id, name, token_hash) values
  ('00000000-0000-4000-8000-000000000371', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003e1', 'T1', pg_temp.h('fb-a1')),
  ('00000000-0000-4000-8000-000000000372', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003e2', 'T2', pg_temp.h('fb-a2')),
  ('00000000-0000-4000-8000-000000000373', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003e3', 'T3', pg_temp.h('fb-a3')),
  ('00000000-0000-4000-8000-000000000374', '00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000003e4', 'TB', pg_temp.h('fb-b1'));

-- ============================================================
-- Abertura de mesa e comanda (JM-182, JM-200), pelo anon, como a rota chama
-- ============================================================
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;

insert into res select 'abre1', tablet_open_session(pg_temp.h('fb-a1'));
insert into ids select 's1', (j ->> 'session_id')::uuid from res where k = 'abre1';
insert into ids select 'tab1', (j -> 'tabs' -> 0 ->> 'id')::uuid from res where k = 'abre1';

select is((tablet_open_session(pg_temp.h('fb-a1')) ->> 'session_id')::uuid, (select v from ids where k = 's1'),
  'o segundo toque devolve a mesma abertura');
select is((select j -> 'tabs' -> 0 ->> 'name' from res where k = 'abre1'), 'Mesa',
  'no modo mesa_unica a abertura nasce com a comanda Mesa');
select is(jsonb_array_length(tablet_open_session(pg_temp.h('fb-a1')) -> 'tabs'), 1,
  'e só com ela, mesmo depois de outro toque');
select throws_ok($$ select tablet_create_tab(pg_temp.h('fb-a1'), 'Maria') $$, 'JMT05', null,
  'no modo mesa_unica o tablet não cria comanda');

-- ============================================================
-- Pedido: preço, número e idempotência (JM-031, JM-032, JM-036)
-- ============================================================
insert into res select 'p1', tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-0001',
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000003f1', 'quantity', 2,
    'option_ids', jsonb_build_array('00000000-0000-4000-8000-000000000382', '00000000-0000-4000-8000-000000000383'),
    'notes', 'sem cebola')));
insert into ids select 'o1', (j ->> 'order_id')::uuid from res where k = 'p1';

select is((select (j ->> 'display_number')::int from res where k = 'p1'), 1, 'primeiro pedido do turno é o 1');
select is((select (j ->> 'subtotal')::numeric from res where k = 'p1'), 27.00::numeric,
  'subtotal calculado no banco: (10 + 2 + 1,50) x 2');

insert into res select 'p1b', tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-0001',
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000003f2', 'quantity', 9)));
select is((select (j ->> 'order_id')::uuid from res where k = 'p1b'), (select v from ids where k = 'o1'),
  'a mesma chave na mesma abertura devolve o mesmo pedido');
select is((select (j ->> 'replayed')::boolean from res where k = 'p1b'), true, 'e avisa que é repetição');

insert into res select 'p2', tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-0002',
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000003f2', 'quantity', 1)));
select is((select (j ->> 'display_number')::int from res where k = 'p2'), 2, 'o segundo pedido da mesma abertura é o 2 (E2E-02)');

insert into res select 'p3', tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-0003',
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000003f2', 'quantity', 1, 'price', 0.01, 'unit_price', 0.01)));
select is((select (j ->> 'subtotal')::numeric from res where k = 'p3'), 5.00::numeric, 'preço mandado pelo tablet é ignorado');

-- ============================================================
-- Recusas do JM-100, cada uma com o seu código (E2E-15)
-- ============================================================
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'curta', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMK01', null, 'chave de idempotência curta é recusada');
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  null, '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMK01', null, 'pedido sem chave de idempotência é recusado');
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), gen_random_uuid(), (select v from ids where k = 'tab1'),
  'chave-pedido-9001', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMS01', null, 'abertura inexistente');

insert into res select 'abre2', tablet_open_session(pg_temp.h('fb-a2'));
insert into ids select 's2', (j ->> 'session_id')::uuid from res where k = 'abre2';
insert into ids select 'tab2', (j -> 'tabs' -> 0 ->> 'id')::uuid from res where k = 'abre2';

select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's2'), (select v from ids where k = 'tab2'),
  'chave-pedido-9002', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMS03', null, 'abertura de outra mesa');
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), gen_random_uuid(),
  'chave-pedido-9003', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMT01', null, 'comanda inexistente');
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab2'),
  'chave-pedido-9004', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMT03', null, 'comanda de outra abertura');

reset role;
insert into table_sessions (id, store_id, table_id, opened_by_device, tab_mode, status, closed_at, close_kind)
values ('00000000-0000-4000-8000-0000000003a9', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003e1',
        '00000000-0000-4000-8000-000000000371', 'mesa_unica', 'closed', now(), 'all_tabs_done');
insert into table_tabs (id, store_id, table_session_id, name, status, opened_by_device, closed_at, closed_by, close_kind)
values ('00000000-0000-4000-8000-0000000003a8', '00000000-0000-4000-8000-0000000003a1', (select v from ids where k = 's1'), 'Antiga',
        'closed', '00000000-0000-4000-8000-000000000371', now(), '00000000-0000-4000-8000-0000000003c1', 'settled_outside');
set local role anon;

select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), '00000000-0000-4000-8000-0000000003a9', (select v from ids where k = 'tab1'),
  'chave-pedido-9005', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMS02', null, 'abertura encerrada');
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), '00000000-0000-4000-8000-0000000003a8',
  'chave-pedido-9006', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMT02', null, 'comanda encerrada');

reset role;
update tables set ordering_enabled = false, ordering_changed_by = '00000000-0000-4000-8000-0000000003c1',
       ordering_changed_at = now(), ordering_disabled_reason = 'teste'
 where id = '00000000-0000-4000-8000-0000000003e1';
set local role anon;
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-9007', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMC01', null, 'mesa em contingência');
reset role;
update tables set ordering_enabled = true, ordering_disabled_reason = null where id = '00000000-0000-4000-8000-0000000003e1';
update stores
   set opening_hours = jsonb_build_array(jsonb_build_object(
         'dow', (extract(dow from now() at time zone 'America/Sao_Paulo')::int + 3) % 7, 'open', '10:00', 'close', '11:00'))
 where id = '00000000-0000-4000-8000-0000000003a1';
set local role anon;
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-9008', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMH01', null, 'loja fechada agora');
reset role;
update stores set opening_hours = null where id = '00000000-0000-4000-8000-0000000003a1';
set local role anon;

select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-9009', '[{"product_id":"00000000-0000-4000-8000-0000000003f3","quantity":1}]') $$, 'JM451', null, 'produto esgotado (E2E-04)');
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-9010', '[{"product_id":"00000000-0000-4000-8000-0000000003f1","quantity":1,"option_ids":["00000000-0000-4000-8000-000000000383"]}]') $$,
  'JM422', null, 'grupo obrigatório sem escolha');
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-9011', '[{"product_id":"00000000-0000-4000-8000-0000000003f1","quantity":1,"option_ids":["00000000-0000-4000-8000-000000000381","00000000-0000-4000-8000-000000000384"]}]') $$,
  'JM422', null, 'complemento esgotado');
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-9012', '[]') $$, 'JM422', null, 'pedido sem item');
select throws_ok($$ select tablet_place_order(pg_temp.h('fb-b1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-9013', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JMS03', null, 'token de outra loja (E2E-22)');
select throws_ok($$ select tablet_place_order(pg_temp.h('nao-existe'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-pedido-9014', '[{"product_id":"00000000-0000-4000-8000-0000000003f2","quantity":1}]') $$, 'JM401', null, 'token desconhecido (E2E-22)');

-- A mesma chave em OUTRA abertura cria pedido novo nela, e nunca devolve o alheio (T5).
insert into res select 'p4', tablet_place_order(pg_temp.h('fb-a2'), (select v from ids where k = 's2'), (select v from ids where k = 'tab2'),
  'chave-pedido-0001',
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000003f2', 'quantity', 1)));
select isnt((select (j ->> 'order_id')::uuid from res where k = 'p4'), (select v from ids where k = 'o1'),
  'a mesma chave em outra abertura não devolve o pedido alheio (E2E-05)');
select is((select (j ->> 'replayed')::boolean from res where k = 'p4'), false, 'e cria pedido novo naquela abertura');

insert into res select 'abreB', tablet_open_session(pg_temp.h('fb-b1'));
insert into res select 'pB', tablet_place_order(pg_temp.h('fb-b1'), (select (j ->> 'session_id')::uuid from res where k = 'abreB'),
  (select (j -> 'tabs' -> 0 ->> 'id')::uuid from res where k = 'abreB'), 'chave-pedido-b001',
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000003f4', 'quantity', 1)));
select is((select (j ->> 'display_number')::int from res where k = 'pB'), 1,
  'a numeração é por loja: a outra loja começa no 1 e não vaza volume');

reset role;
select is(
  (select count(*)::int from order_status_events e
    where e.order_id = (select v from ids where k = 'o1') and e.from_status is null
      and e.to_status = 'confirmed' and e.actor_device_id = '00000000-0000-4000-8000-000000000371'),
  1,
  'o pedido nasce confirmed, pelo tablet, sem toque da equipe (JM-034, E2E-01)'
);
set local role anon;

-- ============================================================
-- Pedido de cancelamento pelo cliente (JM-111)
-- ============================================================
insert into res select 'c1', tablet_request_cancel(pg_temp.h('fb-a1'), (select v from ids where k = 'o1'), null);
select is((select j ->> 'status' from res where k = 'c1'), 'pending', 'o cliente pede o cancelamento, que fica pendente');
insert into res select 'c1b', tablet_request_cancel(pg_temp.h('fb-a1'), (select v from ids where k = 'o1'), null);
select is((select (j ->> 'request_id')::uuid from res where k = 'c1b'), (select (j ->> 'request_id')::uuid from res where k = 'c1'),
  'dois toques não criam dois pedidos de cancelamento');
select throws_ok($$ select tablet_request_cancel(pg_temp.h('fb-a2'), (select v from ids where k = 'o1'), null) $$, 'JM403', null,
  'o tablet de outra mesa não pede cancelamento do pedido alheio');

-- ============================================================
-- Chamado de garçom (JM-038, JM-040, JM-187)
-- ============================================================
insert into res select 'w1', tablet_call_waiter(pg_temp.h('fb-a1'));
select is((select (j ->> 'repeated')::boolean from res where k = 'w1'), false, 'o primeiro toque abre o chamado');
insert into res select 'w1b', tablet_call_waiter(pg_temp.h('fb-a1'));
select is((select (j ->> 'call_id')::uuid from res where k = 'w1b'), (select (j ->> 'call_id')::uuid from res where k = 'w1'),
  'dois toques em 10 s geram 1 chamado (JM-038)');
select throws_ok($$ select tablet_reinforce_call(pg_temp.h('fb-a1'), (select (j ->> 'call_id')::uuid from res where k = 'w1')) $$,
  'JMW01', null, 'o reforço só aparece depois de 3 minutos (JM-040)');

reset role;
update tables set ordering_enabled = false, ordering_changed_by = '00000000-0000-4000-8000-0000000003c1',
       ordering_changed_at = now(), ordering_disabled_reason = 'teste'
 where id = '00000000-0000-4000-8000-0000000003e3';
update devices set status = 'inactive' where id = '00000000-0000-4000-8000-000000000372';
set local role anon;
select lives_ok($$ select tablet_call_waiter(pg_temp.h('fb-a3')) $$,
  'o chamado funciona com a mesa em contingência e sem abertura (JM-187)');
select lives_ok($$ select tablet_call_waiter(pg_temp.h('fb-a2')) $$,
  'e com o tablet desativado, que não pede mais nada');
select throws_ok($$ select tablet_menu(pg_temp.h('fb-a2')) $$, 'JM423', null, 'o tablet desativado não lê o cardápio');

-- ============================================================
-- Resumo do polling (JM-011, JM-203) e heartbeat (JM-184)
-- ============================================================
insert into res select 'sum1', tablet_session_summary(pg_temp.h('fb-a1'));
select is((select (j ->> 'total')::numeric from res where k = 'sum1'), 37.00::numeric,
  'a conta da mesa soma o que foi pedido pelo tablet: 27 + 5 + 5');
select is((select jsonb_array_length(j -> 'tabs' -> 0 -> 'orders') from res where k = 'sum1'), 3,
  'minha comanda lista os três pedidos da abertura');
select is((select j -> 'waiter_call' ->> 'call_id' from res where k = 'sum1'), (select j ->> 'call_id' from res where k = 'w1'),
  'o resumo traz o chamado vivo da mesa');

select lives_ok($$ select device_heartbeat(pg_temp.h('fb-a1'), '1.2.3', 55) $$, 'o tablet manda o heartbeat');
reset role;
select ok(
  (select last_seen_at is not null and battery_level = 55 and app_version = '1.2.3'
     from devices where id = '00000000-0000-4000-8000-000000000371'),
  'e o admin vê último contato, versão e bateria'
);

set local role anon;
select throws_ok($$ select staff_cancel_order((select v from ids where k = 'o1'), 'x') $$, '42501', null,
  'anon não alcança function da equipe');

select * from finish();
rollback;
