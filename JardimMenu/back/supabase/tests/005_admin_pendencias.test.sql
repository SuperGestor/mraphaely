-- Jardim Menu, pendências do admin (migração 20260922120000_admin_pendencias.sql): tempo de
-- mesa parada (JM-122), painel do pixel (JM-062) e vínculo de conta que já existe no Auth
-- (JM-052). Mesmo padrão dos testes 003 e 004: massa própria, papéis da §4 conferidos onde a
-- regra pede, e tudo numa transação desfeita no fim.
--
-- Três coisas que este arquivo prova, e que só o banco pode provar:
-- - o turno é resolvido por shift_date (D12, regra 5): o mesmo evento e o mesmo pedido caem em
--   turnos diferentes conforme o momento em que foram gravados, e nenhuma conta de "dia" é
--   feita fora do banco;
-- - a conversão do painel sai do pedido de verdade (orders e order_items), e não do pixel:
--   pedido cancelado e item removido não contam (JM-033);
-- - o privilégio é nominal: anon não executa nenhuma das três functions (NF-005, regra 2).

begin;

create extension if not exists pgtap with schema extensions;

select plan(67);

-- ---------- apoio ----------
create function pg_temp.h(t text) returns text language sql immutable
as $$ select encode(sha256(t::bytea), 'hex') $$;

-- Acha a linha de um produto dentro de uma das quatro listas do painel. Existe para a
-- asserção falar do produto pelo nome, e não pela posição na lista: a ordem das listas é
-- regra de tela, e mudá-la não deveria quebrar um teste de conteúdo.
create function pg_temp.linha(p_painel jsonb, p_lista text, p_nome text) returns jsonb
language sql immutable
as $$
  select e.valor
    from jsonb_array_elements(p_painel -> p_lista) as e(valor)
   where e.valor ->> 'name' = p_nome
$$;

create temp table ids (k text primary key, v uuid);
create temp table res (k text primary key, j jsonb);
-- O turno vem do banco (shift_date), nunca de uma data escrita à mão no teste.
create temp table dias (k text primary key, d date);
grant all on ids, res, dias to anon, authenticated;

-- ---------- massa ----------
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-000000000501', 'dono@ap.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000502', 'gestor@ap.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000503', 'garcom@ap.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000504', 'cozinha@ap.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000505', 'gestor-b@ap.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000506', 'vinculo@ap.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000507', 'dono-b@ap.test', 'authenticated', 'authenticated');
insert into organizations (id, name) values ('00000000-0000-4000-8000-000000000500', 'Org AP');
insert into stores (id, organization_id, slug, name) values
  ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-000000000500', 'loja-ap-a', 'Loja A'),
  ('00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-000000000500', 'loja-ap-b', 'Loja B');
insert into store_users (id, store_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-000000000501', 'owner'),
  ('00000000-0000-4000-8000-0000000005c2', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-000000000502', 'manager'),
  ('00000000-0000-4000-8000-0000000005c3', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-000000000503', 'waiter'),
  ('00000000-0000-4000-8000-0000000005c4', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-000000000504', 'kitchen'),
  ('00000000-0000-4000-8000-0000000005c5', '00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-000000000505', 'manager'),
  ('00000000-0000-4000-8000-0000000005c6', '00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-000000000507', 'owner');
insert into categories (id, store_id, name) values
  ('00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-0000000005a1', 'Pratos'),
  ('00000000-0000-4000-8000-0000000005d2', '00000000-0000-4000-8000-0000000005b1', 'Vinhos');

-- Sete produtos no cardápio e dois fora dele. O nome diz o papel de cada um no painel; é o
-- que as asserções procuram.
insert into products (id, store_id, category_id, name, price, is_active) values
  ('00000000-0000-4000-8000-0000000005f1', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005d1', 'Campeão', 10, true),
  ('00000000-0000-4000-8000-0000000005f2', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005d1', 'Visto sem pedido', 10, true),
  ('00000000-0000-4000-8000-0000000005f3', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005d1', 'Nunca visto', 10, true),
  ('00000000-0000-4000-8000-0000000005f4', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005d1', 'Pouco visto', 10, true),
  ('00000000-0000-4000-8000-0000000005f5', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005d1', 'Só cancelado', 10, true),
  ('00000000-0000-4000-8000-0000000005f6', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005d1', 'Pedido de ontem', 10, true),
  ('00000000-0000-4000-8000-0000000005f7', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005d1', 'Pedido sem pixel', 10, true),
  ('00000000-0000-4000-8000-0000000005f8', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005d1', 'Fora do cardápio', 10, false),
  ('00000000-0000-4000-8000-0000000005f9', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005d1', 'Fora com movimento', 10, false),
  ('00000000-0000-4000-8000-0000000005fb', '00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-0000000005d2', 'Vinho da outra loja', 20, true);

insert into tables (id, store_id, number) values
  ('00000000-0000-4000-8000-0000000005e1', '00000000-0000-4000-8000-0000000005a1', 1),
  ('00000000-0000-4000-8000-0000000005e2', '00000000-0000-4000-8000-0000000005b1', 1);
insert into devices (id, store_id, table_id, name, token_hash) values
  ('00000000-0000-4000-8000-000000000571', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005e1', 'T1', pg_temp.h('ap-a1')),
  ('00000000-0000-4000-8000-000000000572', '00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-0000000005e2', 'TB', pg_temp.h('ap-b1'));

insert into dias (k, d) values
  ('hoje', shift_date(now(), '00000000-0000-4000-8000-0000000005a1')),
  ('ontem', shift_date(now(), '00000000-0000-4000-8000-0000000005a1') - 1),
  ('amanha', shift_date(now(), '00000000-0000-4000-8000-0000000005a1') + 1);

-- Abertura e comanda: o pedido é gravado direto, e não pelo tablet, para o teste escolher o
-- turno e o status de cada um. O caminho do tablet é o assunto do 003.
insert into table_sessions (id, store_id, table_id, opened_by_device, tab_mode) values
  ('00000000-0000-4000-8000-0000000005a9', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005e1', '00000000-0000-4000-8000-000000000571', 'mesa_unica'),
  ('00000000-0000-4000-8000-0000000005b9', '00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-0000000005e2', '00000000-0000-4000-8000-000000000572', 'mesa_unica');
insert into table_tabs (id, store_id, table_session_id, name, opened_by_device) values
  ('00000000-0000-4000-8000-0000000005a8', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005a9', 'Mesa', '00000000-0000-4000-8000-000000000571'),
  ('00000000-0000-4000-8000-0000000005b8', '00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-0000000005b9', 'Mesa', '00000000-0000-4000-8000-000000000572');

insert into orders (id, store_id, table_session_id, tab_id, device_id, status, idempotency_key, business_date, display_number, subtotal) values
  ('00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005a9',
   '00000000-0000-4000-8000-0000000005a8', '00000000-0000-4000-8000-000000000571', 'confirmed', 'massa-painel-0001',
   (select d from dias where k = 'hoje'), 1, 20),
  ('00000000-0000-4000-8000-000000000522', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005a9',
   '00000000-0000-4000-8000-0000000005a8', '00000000-0000-4000-8000-000000000571', 'confirmed', 'massa-painel-0002',
   (select d from dias where k = 'hoje'), 2, 10),
  ('00000000-0000-4000-8000-000000000524', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005a9',
   '00000000-0000-4000-8000-0000000005a8', '00000000-0000-4000-8000-000000000571', 'confirmed', 'massa-painel-0004',
   (select d from dias where k = 'ontem'), 1, 10),
  ('00000000-0000-4000-8000-000000000525', '00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-0000000005b9',
   '00000000-0000-4000-8000-0000000005b8', '00000000-0000-4000-8000-000000000572', 'confirmed', 'massa-painel-000b',
   (select d from dias where k = 'hoje'), 1, 20);
insert into orders (id, store_id, table_session_id, tab_id, device_id, status, idempotency_key, business_date, display_number, subtotal,
                    cancelled_at, cancelled_by, cancel_reason) values
  ('00000000-0000-4000-8000-000000000523', '00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005a9',
   '00000000-0000-4000-8000-0000000005a8', '00000000-0000-4000-8000-000000000571', 'cancelled', 'massa-painel-0003',
   (select d from dias where k = 'hoje'), 3, 10,
   now(), '00000000-0000-4000-8000-0000000005c1', 'massa: pedido cancelado');

insert into order_items (order_id, product_id, product_name, unit_price, quantity, line_total) values
  ('00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-0000000005f1', 'Campeão', 10, 1, 10),
  ('00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-0000000005f7', 'Pedido sem pixel', 10, 1, 10),
  ('00000000-0000-4000-8000-000000000522', '00000000-0000-4000-8000-0000000005f1', 'Campeão', 10, 1, 10),
  ('00000000-0000-4000-8000-000000000523', '00000000-0000-4000-8000-0000000005f5', 'Só cancelado', 10, 1, 10),
  ('00000000-0000-4000-8000-000000000524', '00000000-0000-4000-8000-0000000005f6', 'Pedido de ontem', 10, 1, 10),
  ('00000000-0000-4000-8000-000000000525', '00000000-0000-4000-8000-0000000005fb', 'Vinho da outra loja', 20, 1, 20);
-- Item removido pela equipe (JM-033): fica no pedido, mas sai da conta e da conversão.
insert into order_items (order_id, product_id, product_name, unit_price, quantity, line_total, removed_at, removed_by, remove_reason) values
  ('00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-0000000005f5', 'Só cancelado', 10, 1, 10,
   now(), '00000000-0000-4000-8000-0000000005c1', 'massa: item removido');

insert into menu_sessions (id, store_id) values
  ('00000000-0000-4000-8000-000000000591', '00000000-0000-4000-8000-0000000005a1'),
  ('00000000-0000-4000-8000-000000000592', '00000000-0000-4000-8000-0000000005b1');

-- Pixel do turno de hoje. Quatro impressões para o produto comum, uma só para o pouco visto:
-- com a mediana em 4, o limite do "pouco visto" é 1 (um quarto de 4).
insert into menu_events (session_id, store_id, event_type, product_id, received_at)
select '00000000-0000-4000-8000-000000000591', '00000000-0000-4000-8000-0000000005a1', m.tipo, m.produto, now()
  from (values
    ('product_impression', '00000000-0000-4000-8000-0000000005f1'::uuid, 4),
    ('product_click',      '00000000-0000-4000-8000-0000000005f1'::uuid, 2),
    ('add_to_cart',        '00000000-0000-4000-8000-0000000005f1'::uuid, 1),
    ('product_impression', '00000000-0000-4000-8000-0000000005f2'::uuid, 4),
    ('product_impression', '00000000-0000-4000-8000-0000000005f4'::uuid, 1),
    ('product_impression', '00000000-0000-4000-8000-0000000005f5'::uuid, 4),
    ('product_impression', '00000000-0000-4000-8000-0000000005f6'::uuid, 4),
    ('product_impression', '00000000-0000-4000-8000-0000000005f9'::uuid, 4)
  ) as m(tipo, produto, n)
  cross join lateral generate_series(1, m.n);
-- Uma impressão de ONTEM para o "Nunca visto": ela está dentro da janela larga que a function
-- usa para alcançar o índice, e só a shift_date a tira do turno de hoje (D12).
insert into menu_events (session_id, store_id, event_type, product_id, received_at) values
  ('00000000-0000-4000-8000-000000000591', '00000000-0000-4000-8000-0000000005a1', 'product_impression',
   '00000000-0000-4000-8000-0000000005f3', now() - interval '1 day');
-- Movimento da outra loja, que nenhum painel da loja A pode mostrar.
insert into menu_events (session_id, store_id, event_type, product_id, received_at) values
  ('00000000-0000-4000-8000-000000000592', '00000000-0000-4000-8000-0000000005b1', 'product_impression',
   '00000000-0000-4000-8000-0000000005fb', now()),
  ('00000000-0000-4000-8000-000000000592', '00000000-0000-4000-8000-0000000005b1', 'product_impression',
   '00000000-0000-4000-8000-0000000005fb', now());

-- ============================================================
-- 1. Tempo de mesa parada (JM-122)
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000501","role":"authenticated"}';

select lives_ok($$ select admin_update_store_idle_alert('00000000-0000-4000-8000-0000000005a1', 30) $$,
  'o dono aceita o piso de 30 minutos');
reset role;
select is((select idle_table_alert_minutes from stores where id = '00000000-0000-4000-8000-0000000005a1'), 30,
  'e o piso grava mesmo em stores');
set local role authenticated;
select lives_ok($$ select admin_update_store_idle_alert('00000000-0000-4000-8000-0000000005a1', 1440) $$,
  'e o teto de 1440 minutos');
reset role;
select is((select idle_table_alert_minutes from stores where id = '00000000-0000-4000-8000-0000000005a1'), 1440,
  'e o teto também grava');
set local role authenticated;

-- A function recusa antes do CHECK stores_idle_alert_ck, com JM422, para a tela poder dizer o
-- limite em vez de mostrar erro interno.
select throws_ok($$ select admin_update_store_idle_alert('00000000-0000-4000-8000-0000000005a1', 29) $$,
  'JM422', null, '29 minutos é recusado pela function, e não pelo CHECK');
select throws_ok($$ select admin_update_store_idle_alert('00000000-0000-4000-8000-0000000005a1', 1441) $$,
  'JM422', null, '1441 minutos é recusado pela function, e não pelo CHECK');
select throws_ok($$ select admin_update_store_idle_alert('00000000-0000-4000-8000-0000000005a1', null) $$,
  'JM422', null, 'sem valor é recusado');
reset role;
select is((select idle_table_alert_minutes from stores where id = '00000000-0000-4000-8000-0000000005a1'), 1440,
  'e nenhuma recusa de faixa mexeu no valor gravado');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000502","role":"authenticated"}';
select lives_ok($$ select admin_update_store_idle_alert('00000000-0000-4000-8000-0000000005a1', 60) $$,
  'o gestor também ajusta o tempo de mesa parada');
reset role;
select is((select idle_table_alert_minutes from stores where id = '00000000-0000-4000-8000-0000000005a1'), 60,
  'e o valor do gestor grava');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000503","role":"authenticated"}';
select throws_ok($$ select admin_update_store_idle_alert('00000000-0000-4000-8000-0000000005a1', 90) $$,
  'JM403', null, 'garçom não ajusta o tempo de mesa parada (§4)');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000504","role":"authenticated"}';
select throws_ok($$ select admin_update_store_idle_alert('00000000-0000-4000-8000-0000000005a1', 90) $$,
  'JM403', null, 'cozinha não ajusta o tempo de mesa parada (§4)');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000505","role":"authenticated"}';
select throws_ok($$ select admin_update_store_idle_alert('00000000-0000-4000-8000-0000000005a1', 90) $$,
  'JM403', null, 'gestor de outra loja não ajusta o tempo da loja alheia');
reset role;
select is((select idle_table_alert_minutes from stores where id = '00000000-0000-4000-8000-0000000005a1'), 60,
  'e nenhuma recusa de papel mexeu no valor gravado');

-- ============================================================
-- 2. Painel do pixel (JM-062)
-- ============================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000503","role":"authenticated"}';
select throws_ok($$ select admin_menu_panel('00000000-0000-4000-8000-0000000005a1') $$,
  'JM403', null, 'garçom não abre o painel do cardápio (JM-062)');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000504","role":"authenticated"}';
select throws_ok($$ select admin_menu_panel('00000000-0000-4000-8000-0000000005a1') $$,
  'JM403', null, 'cozinha não abre o painel do cardápio');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000505","role":"authenticated"}';
select throws_ok($$ select admin_menu_panel('00000000-0000-4000-8000-0000000005a1') $$,
  'JM403', null, 'gestor de outra loja não abre o painel alheio');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000501","role":"authenticated"}';
insert into res select 'hoje', admin_menu_panel('00000000-0000-4000-8000-0000000005a1');

select is((select (j ->> 'business_date')::date from res where k = 'hoje'), (select d from dias where k = 'hoje'),
  'sem data, o painel é o do turno de agora, resolvido no banco (D12)');
select is((select (j ->> 'previous_business_date')::date from res where k = 'hoje'), (select d from dias where k = 'ontem'),
  'e oferece o turno anterior');
select is((select j ->> 'next_business_date' from res where k = 'hoje'), null,
  'o turno de hoje não tem próximo');

select is((select (j -> 'totals' ->> 'products')::int from res where k = 'hoje'), 8,
  'o painel tem os 7 produtos do cardápio mais o que saiu dele com movimento');
select is((select (j -> 'totals' ->> 'impressions')::int from res where k = 'hoje'), 21,
  'as impressões do turno somam as das mesmas linhas listadas');
select is((select (j -> 'totals' ->> 'clicks')::int from res where k = 'hoje'), 2, 'e os cliques do turno');
select is((select (j -> 'totals' ->> 'adds_to_cart')::int from res where k = 'hoje'), 1, 'e o "na sacola" do turno');
select is((select (j -> 'totals' ->> 'orders')::int from res where k = 'hoje'), 2,
  'os pedidos do turno não contam o cancelado (JM-033)');
select is((select (j -> 'totals' ->> 'ordered_products')::int from res where k = 'hoje'), 2,
  'e dois produtos foram pedidos de verdade');

select is((select (j -> 'rules' ->> 'median_impressions')::numeric from res where k = 'hoje'), 4::numeric,
  'a régua vai junto: a mediana de impressões do turno é 4');
select is((select (j -> 'rules' ->> 'low_view_max')::numeric from res where k = 'hoje'), 1::numeric,
  'e o limite do pouco visto é um quarto dela');

select is((select jsonb_array_length(j -> 'never_seen') from res where k = 'hoje'), 2,
  'dois produtos passaram o turno sem uma impressão');
select is((select (pg_temp.linha(j, 'never_seen', 'Nunca visto') ->> 'impressions')::int from res where k = 'hoje'), 0,
  'produto sem impressão no turno aparece como nunca visto, mesmo com impressão de ontem');
select is((select (pg_temp.linha(j, 'never_seen', 'Pedido sem pixel') ->> 'orders')::int from res where k = 'hoje'), 1,
  'e o pedido sem evento de pixel aparece ali com o pedido à vista (o pixel pode perder evento)');

select is((select jsonb_array_length(j -> 'champions') from res where k = 'hoje'), 1,
  'um único produto passa o piso de impressões e tem pedido');
select is((select (pg_temp.linha(j, 'champions', 'Campeão') ->> 'conversion')::numeric from res where k = 'hoje'), 0.5::numeric,
  'a conversão é pedidos sobre impressões: 2 de 4');
select is((select (pg_temp.linha(j, 'champions', 'Campeão') ->> 'orders')::int from res where k = 'hoje'), 2,
  'e os pedidos saem dos order_items, e não do evento order_submitted');
select is((select (pg_temp.linha(j, 'champions', 'Campeão') ->> 'quantity')::int from res where k = 'hoje'), 2,
  'com a quantidade vendida junto');

select is((select jsonb_array_length(j -> 'seen_no_conversion') from res where k = 'hoje'), 5,
  'cinco produtos foram vistos e não saíram');
select is((select (pg_temp.linha(j, 'seen_no_conversion', 'Só cancelado') ->> 'orders')::int from res where k = 'hoje'), 0,
  'pedido cancelado e item removido não contam como pedido (JM-033)');
select is((select (pg_temp.linha(j, 'seen_no_conversion', 'Só cancelado') ->> 'impressions')::int from res where k = 'hoje'), 4,
  'mas as impressões dele continuam contadas');
select is((select (pg_temp.linha(j, 'seen_no_conversion', 'Pedido de ontem') ->> 'orders')::int from res where k = 'hoje'), 0,
  'o pedido de outro turno não entra no turno de hoje (D12)');

select is((select jsonb_array_length(j -> 'low_seen') from res where k = 'hoje'), 1,
  'um único produto ficou em um quarto da mediana');
select is((select (pg_temp.linha(j, 'low_seen', 'Pouco visto') ->> 'impressions')::int from res where k = 'hoje'), 1,
  'e é o de uma impressão só');

select is((select pg_temp.linha(j, 'seen_no_conversion', 'Fora com movimento') ->> 'in_menu' from res where k = 'hoje'), 'false',
  'o produto que saiu do cardápio mas teve movimento aparece, marcado como fora dele');
select ok((select position('Fora do cardápio' in j::text) = 0 from res where k = 'hoje'),
  'o produto fora do cardápio e sem movimento não aparece');
select ok((select position('Vinho da outra loja' in j::text) = 0 from res where k = 'hoje'),
  'e nada da outra loja aparece, nem produto nem movimento');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000502","role":"authenticated"}';
select is((admin_menu_panel('00000000-0000-4000-8000-0000000005a1') ->> 'business_date')::date, (select d from dias where k = 'hoje'),
  'o gestor também abre o painel (JM-062)');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000501","role":"authenticated"}';
insert into res select 'ontem', admin_menu_panel('00000000-0000-4000-8000-0000000005a1', (select d from dias where k = 'ontem'));

select is((select (j ->> 'business_date')::date from res where k = 'ontem'), (select d from dias where k = 'ontem'),
  'o painel do turno anterior é o turno anterior');
select is((select (j ->> 'next_business_date')::date from res where k = 'ontem'), (select d from dias where k = 'hoje'),
  'e dali dá para andar para a frente');
select is((select (j -> 'totals' ->> 'orders')::int from res where k = 'ontem'), 1,
  'o turno de ontem tem só o pedido de ontem');
select is((select (j -> 'totals' ->> 'impressions')::int from res where k = 'ontem'), 1,
  'e só a impressão de ontem: as 21 de hoje ficam no turno de hoje (D12)');
select is((select (pg_temp.linha(j, 'never_seen', 'Pedido de ontem') ->> 'orders')::int from res where k = 'ontem'), 1,
  'o pedido de ontem conta no turno em que foi feito');
select is((select (pg_temp.linha(j, 'seen_no_conversion', 'Nunca visto') ->> 'impressions')::int from res where k = 'ontem'), 1,
  'e a impressão de ontem conta no turno de ontem, pela shift_date e não pelo relógio de quem chama');

select throws_ok($$ select admin_menu_panel('00000000-0000-4000-8000-0000000005a1', (select d from dias where k = 'amanha')) $$,
  'JM422', null, 'turno no futuro é recusado');

-- ============================================================
-- 3. Vínculo de conta que já existe no Auth (JM-052)
-- ============================================================

-- A regra atual é a mesma do admin_add_store_user: só o dono vincula.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000502","role":"authenticated"}';
select throws_ok($$ select admin_link_existing_user('00000000-0000-4000-8000-0000000005a1', 'vinculo@ap.test', 'waiter') $$,
  'JM403', null, 'gestor não vincula conta à loja: só o dono, como no admin_add_store_user');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000503","role":"authenticated"}';
select throws_ok($$ select admin_link_existing_user('00000000-0000-4000-8000-0000000005a1', 'vinculo@ap.test', 'waiter') $$,
  'JM403', null, 'garçom não vincula conta à loja');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000507","role":"authenticated"}';
select throws_ok($$ select admin_link_existing_user('00000000-0000-4000-8000-0000000005a1', 'vinculo@ap.test', 'waiter') $$,
  'JM403', null, 'o dono da outra loja não vincula ninguém na loja alheia');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000501","role":"authenticated"}';
select throws_ok($$ select admin_link_existing_user('00000000-0000-4000-8000-0000000005a1', 'ninguem@ap.test', 'waiter') $$,
  'JM404', null, 'e-mail sem conta no Auth tem erro próprio, e a rota segue para o convite');
select throws_ok($$ select admin_link_existing_user('00000000-0000-4000-8000-0000000005a1', 'vinculo@ap.test', 'chefe') $$,
  'JM422', null, 'papel fora dos quatro da §4 é recusado');
select throws_ok($$ select admin_link_existing_user('00000000-0000-4000-8000-0000000005a1', 'sem-arroba', 'waiter') $$,
  'JM422', null, 'e-mail malformado é recusado antes de procurar conta');

-- O e-mail chega da tela como o usuário digitou; a function apara e baixa a caixa.
insert into ids select 'vinculo', admin_link_existing_user('00000000-0000-4000-8000-0000000005a1', '  Vinculo@AP.test  ', 'waiter');
select ok((select v is not null from ids where k = 'vinculo'),
  'o e-mail que já tem conta vira vínculo, com espaço e maiúscula aparados');
reset role;
select ok((select su.role = 'waiter' and su.is_active from store_users su
            where su.store_id = '00000000-0000-4000-8000-0000000005a1'
              and su.user_id = '00000000-0000-4000-8000-000000000506'),
  'e o vínculo nasce ativo, com o papel pedido');
select is((select su.id from store_users su
            where su.store_id = '00000000-0000-4000-8000-0000000005a1'
              and su.user_id = '00000000-0000-4000-8000-000000000506'),
  (select v from ids where k = 'vinculo'),
  'o id devolvido é o do vínculo criado, e nada da conta sai junto (NF-006)');

set local role authenticated;
select throws_ok($$ select admin_link_existing_user('00000000-0000-4000-8000-0000000005a1', 'vinculo@ap.test', 'manager') $$,
  'JM409', null, 'vincular o mesmo e-mail de novo é recusado, e não troca o papel pela porta do convite');
reset role;
select is((select count(*)::int from store_users su
            where su.store_id = '00000000-0000-4000-8000-0000000005a1'
              and su.user_id = '00000000-0000-4000-8000-000000000506'), 1,
  'e o vínculo não duplicou');

-- Reativar quem foi desativado é da lista de usuários (admin_set_store_user_role), que protege
-- o último dono; o convite não é caminho para isso.
update store_users set is_active = false, deactivated_at = now()
 where store_id = '00000000-0000-4000-8000-0000000005a1'
   and user_id = '00000000-0000-4000-8000-000000000506';
set local role authenticated;
select throws_ok($$ select admin_link_existing_user('00000000-0000-4000-8000-0000000005a1', 'vinculo@ap.test', 'waiter') $$,
  'JM409', null, 'conta desativada na loja não volta pelo vínculo');

-- ============================================================
-- 4. Privilégio nominal: anon não executa nenhuma das três (NF-005, regra 2)
-- ============================================================

reset role;
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;

select throws_ok($$ select admin_update_store_idle_alert('00000000-0000-4000-8000-0000000005a1', 60) $$,
  '42501', null, 'anon não ajusta o tempo de mesa parada');
select throws_ok($$ select admin_menu_panel('00000000-0000-4000-8000-0000000005a1') $$,
  '42501', null, 'anon não abre o painel do cardápio');
select throws_ok($$ select admin_link_existing_user('00000000-0000-4000-8000-0000000005a1', 'vinculo@ap.test', 'waiter') $$,
  '42501', null, 'anon não vincula conta à loja');

select * from finish();
rollback;
