-- Jardim Menu, Fase B, caminho da equipe (prompt 3): retrato do salão, cancelamento em
-- duas portas (JM-033, JM-111), chamado atendido (JM-039), encerrar, renomear e migrar
-- comanda (JM-208, JM-209), giro de mesa sem herança, fechar mesa (JM-141), contingência
-- (JM-186) e modo de comanda (JM-200). Papéis da §4: cozinha e garçom recusados onde a
-- regra pede. Tudo numa transação desfeita no fim.

begin;

create extension if not exists pgtap with schema extensions;

select plan(47);

-- ---------- apoio ----------
create function pg_temp.h(t text) returns text language sql immutable
as $$ select encode(sha256(t::bytea), 'hex') $$;

create temp table ids (k text primary key, v uuid);
create temp table res (k text primary key, j jsonb);
grant all on ids, res to anon, authenticated;

-- ---------- massa ----------
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-000000000401', 'dono@fe.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000402', 'gestor@fe.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000403', 'garcom@fe.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000404', 'cozinha@fe.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000405', 'gestor-b@fe.test', 'authenticated', 'authenticated');
insert into organizations (id, name) values ('00000000-0000-4000-8000-000000000400', 'Org FE');
insert into stores (id, organization_id, slug, name) values
  ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-000000000400', 'loja-fe-a', 'Loja A'),
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-000000000400', 'loja-fe-b', 'Loja B');
insert into store_users (id, store_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000004c1', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-000000000401', 'owner'),
  ('00000000-0000-4000-8000-0000000004c2', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-000000000402', 'manager'),
  ('00000000-0000-4000-8000-0000000004c3', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-000000000403', 'waiter'),
  ('00000000-0000-4000-8000-0000000004c4', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-000000000404', 'kitchen'),
  ('00000000-0000-4000-8000-0000000004c5', '00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-000000000405', 'manager');
insert into categories (id, store_id, name) values
  ('00000000-0000-4000-8000-0000000004d1', '00000000-0000-4000-8000-0000000004a1', 'Pratos');
insert into products (id, store_id, category_id, name, price, pdv_code) values
  ('00000000-0000-4000-8000-0000000004f1', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000004d1', 'Prato', 20, 'PDV-9'),
  ('00000000-0000-4000-8000-0000000004f2', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000004d1', 'Suco', 8, null);
insert into tables (id, store_id, number) values
  ('00000000-0000-4000-8000-0000000004e1', '00000000-0000-4000-8000-0000000004a1', 1),
  ('00000000-0000-4000-8000-0000000004e2', '00000000-0000-4000-8000-0000000004a1', 2),
  ('00000000-0000-4000-8000-0000000004e3', '00000000-0000-4000-8000-0000000004a1', 3),
  ('00000000-0000-4000-8000-0000000004e4', '00000000-0000-4000-8000-0000000004b1', 1);
insert into devices (id, store_id, table_id, name, token_hash) values
  ('00000000-0000-4000-8000-000000000471', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000004e1', 'T1', pg_temp.h('fe-a1')),
  ('00000000-0000-4000-8000-000000000472', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000004e2', 'T2', pg_temp.h('fe-a2'));

-- ---------- o salão, pelo tablet ----------
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;

insert into res select 'abre1', tablet_open_session(pg_temp.h('fe-a1'));
insert into ids select 's1', (j ->> 'session_id')::uuid from res where k = 'abre1';
insert into ids select 'tab1', (j -> 'tabs' -> 0 ->> 'id')::uuid from res where k = 'abre1';
insert into res select 'o1', tablet_place_order(pg_temp.h('fe-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-equipe-0001', jsonb_build_array(
    jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000004f1', 'quantity', 1),
    jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000004f2', 'quantity', 2, 'notes', 'sem gelo')));
insert into ids select 'o1', (j ->> 'order_id')::uuid from res where k = 'o1';
insert into res select 'o2', tablet_place_order(pg_temp.h('fe-a1'), (select v from ids where k = 's1'), (select v from ids where k = 'tab1'),
  'chave-equipe-0002', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000004f2', 'quantity', 1)));
insert into ids select 'o2', (j ->> 'order_id')::uuid from res where k = 'o2';

insert into res select 'abre2', tablet_open_session(pg_temp.h('fe-a2'));
insert into ids select 's2', (j ->> 'session_id')::uuid from res where k = 'abre2';
insert into ids select 'tab2', (j -> 'tabs' -> 0 ->> 'id')::uuid from res where k = 'abre2';
insert into res select 'o3', tablet_place_order(pg_temp.h('fe-a2'), (select v from ids where k = 's2'), (select v from ids where k = 'tab2'),
  'chave-equipe-0003', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000004f1', 'quantity', 1)));
insert into ids select 'o3', (j ->> 'order_id')::uuid from res where k = 'o3';

insert into res select 'w1', tablet_call_waiter(pg_temp.h('fe-a1'));
insert into res select 'r1', tablet_request_cancel(pg_temp.h('fe-a1'), (select v from ids where k = 'o2'), null);

reset role;
insert into ids select 'item_suco', i.id from order_items i
 where i.order_id = (select v from ids where k = 'o1') and i.product_name = 'Suco';
insert into ids select 'item_prato', i.id from order_items i
 where i.order_id = (select v from ids where k = 'o1') and i.product_name = 'Prato';
set local role anon;
insert into res select 'r2', tablet_request_cancel(pg_temp.h('fe-a1'), (select v from ids where k = 'o1'), (select v from ids where k = 'item_suco'));

-- ============================================================
-- Papéis (§4, §9.4)
-- ============================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000404","role":"authenticated"}';
select throws_ok($$ select staff_cancel_order((select v from ids where k = 'o1'), 'teste') $$, 'JM403', null,
  'cozinha não cancela pedido (§9.4)');
select throws_ok($$ select staff_floor('00000000-0000-4000-8000-0000000004a1') $$, 'JM403', null,
  'cozinha não abre a tela da equipe da primeira versão');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000405","role":"authenticated"}';
select throws_ok($$ select staff_floor('00000000-0000-4000-8000-0000000004a1') $$, 'JM403', null,
  'gestor de outra loja não vê o salão alheio');
select throws_ok($$ select staff_close_tab((select v from ids where k = 'tab1')) $$, 'JM403', null,
  'gestor de outra loja não encerra comanda alheia');

-- ============================================================
-- Retrato do salão (JM-121)
-- ============================================================
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000403","role":"authenticated"}';
insert into res select 'salao1', staff_floor('00000000-0000-4000-8000-0000000004a1');
select is((select jsonb_array_length(j -> 'tables') from res where k = 'salao1'), 3, 'o garçom vê as três mesas da loja');
select is((select jsonb_array_length(j -> 'cancel_requests') from res where k = 'salao1'), 2,
  'e os dois pedidos de cancelamento pendentes');
select ok((select position('PDV-9' in j::text) > 0 from res where k = 'salao1'), 'com o código do PDV de cada item (D31)');
select ok((select position('sem gelo' in j::text) > 0 from res where k = 'salao1'), 'e a observação do item');
select is((select jsonb_array_length(j -> 'tables' -> 0 -> 'calls') from res where k = 'salao1'), 1,
  'e o chamado aberto da mesa 1');

-- ============================================================
-- Cancelamento em duas portas (JM-033, JM-111)
-- ============================================================
select throws_ok($$ select staff_cancel_order((select v from ids where k = 'o1'), '  ') $$, 'JM422', null,
  'cancelar exige motivo');
select lives_ok($$ select staff_decide_cancel_request((select (j ->> 'request_id')::uuid from res where k = 'r1'), true, null) $$,
  'o garçom aprova o pedido de cancelamento do pedido inteiro');
reset role;
select is((select status from orders where id = (select v from ids where k = 'o2')), 'cancelled',
  'aprovar cancela o pedido, na mesma transação');
select is((select count(*)::int from order_status_events where order_id = (select v from ids where k = 'o2')
             and to_status = 'cancelled' and actor_user_id = '00000000-0000-4000-8000-0000000004c3'), 1,
  'com a transição gravada e o autor');
set local role authenticated;
select throws_ok($$ select staff_decide_cancel_request((select (j ->> 'request_id')::uuid from res where k = 'r1'), false, null) $$,
  'JM409', null, 'pedido de cancelamento já decidido não muda');
select lives_ok($$ select staff_decide_cancel_request((select (j ->> 'request_id')::uuid from res where k = 'r2'), false, 'já saiu') $$,
  'o garçom recusa o pedido de cancelamento do item');
select lives_ok($$ select staff_remove_item((select v from ids where k = 'item_prato'), 'prato errado') $$,
  'o garçom remove um item, com motivo');
reset role;
select is((select subtotal from orders where id = (select v from ids where k = 'o1')), 16.00::numeric,
  'e o subtotal do pedido é recalculado: só os 2 sucos');
set local role anon;
insert into res select 'resumo1', tablet_session_summary(pg_temp.h('fe-a1'));
select is((select (j ->> 'total')::numeric from res where k = 'resumo1'), 16.00::numeric,
  'o tablet vê a conta sem o pedido cancelado e sem o item removido');
select ok((select position('rejected' in (j -> 'cancel_requests')::text) > 0 from res where k = 'resumo1'),
  'e o aviso da recusa do pedido de cancelamento');

set local role authenticated;
select lives_ok($$ select staff_ack_waiter_call((select (j ->> 'call_id')::uuid from res where k = 'w1')) $$,
  'o garçom atende o chamado');
set local role anon;
select isnt((select tablet_session_summary(pg_temp.h('fe-a1')) -> 'waiter_call' ->> 'acknowledged_at'), null,
  'e o tablet recebe "garçom a caminho" no próximo polling');

-- ============================================================
-- Migrar comanda (JM-209, E2E-26)
-- ============================================================
set local role authenticated;
select throws_ok($$ select staff_move_tab((select v from ids where k = 'tab2'), '00000000-0000-4000-8000-0000000004e4') $$,
  'JM403', null, 'migrar para mesa de outra loja é recusado (§9.4)');
select throws_ok($$ select staff_move_tab((select v from ids where k = 'tab2'), '00000000-0000-4000-8000-0000000004e1') $$,
  'JMT04', null, 'migrar para mesa onde o nome já existe é recusado');
select lives_ok($$ select staff_rename_tab((select v from ids where k = 'tab2'), 'Varanda') $$, 'a equipe renomeia a comanda');
insert into res select 'mov', staff_move_tab((select v from ids where k = 'tab2'), '00000000-0000-4000-8000-0000000004e1');
select is((select (j ->> 'origin_closed')::boolean from res where k = 'mov'), true,
  'a mesa de origem fecha quando a última comanda sai');
reset role;
select is((select count(*)::int from tab_moves where tab_id = (select v from ids where k = 'tab2')), 1,
  'a migração fica registrada, com quem migrou');
select is((select table_session_id from orders where id = (select v from ids where k = 'o3')), (select v from ids where k = 's2'),
  'o pedido continua na abertura em que foi feito');
set local role anon;
select is((select (tablet_session_summary(pg_temp.h('fe-a1')) ->> 'total')::numeric), 36.00::numeric,
  'a conta acompanha a comanda: a mesa 1 soma 16 + 20');

-- ============================================================
-- Encerrar comanda e girar a mesa (JM-208, E2E-25)
-- ============================================================
set local role authenticated;
select is((select (staff_close_tab((select v from ids where k = 'tab1')) ->> 'session_closed')::boolean), false,
  'encerrar uma comanda com outra aberta não fecha a mesa');
select throws_ok($$ select staff_close_tab((select v from ids where k = 'tab1')) $$, 'JMT02', null, 'comanda encerrada não encerra de novo');
select throws_ok($$ select staff_move_tab((select v from ids where k = 'tab1'), '00000000-0000-4000-8000-0000000004e3') $$,
  'JMT02', null, 'comanda encerrada não migra');
select is((select (staff_close_tab((select v from ids where k = 'tab2')) ->> 'session_closed')::boolean), true,
  'encerrada a última comanda, a abertura fecha sozinha');
set local role anon;
insert into res select 'abre3', tablet_open_session(pg_temp.h('fe-a1'));
select isnt((select (j ->> 'session_id')::uuid from res where k = 'abre3'), (select v from ids where k = 's1'),
  'o toque seguinte abre outra abertura');
select is((select (tablet_session_summary(pg_temp.h('fe-a1')) ->> 'total')::numeric), 0::numeric,
  'que não herda nada');

-- ============================================================
-- Fechar mesa pelo gerente (JM-141) e contingência (JM-186)
-- ============================================================
set local role authenticated;
select throws_ok($$ select staff_force_close_session((select (j ->> 'session_id')::uuid from res where k = 'abre3'), 'teste') $$,
  'JM403', null, 'garçom não fecha mesa com comanda aberta');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000402","role":"authenticated"}';
select throws_ok($$ select staff_force_close_session((select (j ->> 'session_id')::uuid from res where k = 'abre3'), '') $$,
  'JM422', null, 'fechar mesa exige motivo');
select lives_ok($$ select staff_force_close_session((select (j ->> 'session_id')::uuid from res where k = 'abre3'), 'cliente saiu') $$,
  'o gestor fecha a mesa com motivo');
reset role;
select is((select close_kind || '/' || close_reason from table_sessions where id = (select (j ->> 'session_id')::uuid from res where k = 'abre3')),
  'manager_forced/cliente saiu', 'com autor, horário e motivo na abertura');

set local role authenticated;
select lives_ok($$ select staff_set_table_ordering('00000000-0000-4000-8000-0000000004e1', false, 'tablet quebrou') $$,
  'o gestor põe a mesa em contingência, com motivo');
set local role anon;
insert into res select 'abre4', tablet_open_session(pg_temp.h('fe-a1'));
select throws_ok($$ select tablet_place_order(pg_temp.h('fe-a1'), (select (j ->> 'session_id')::uuid from res where k = 'abre4'),
  (select (j -> 'tabs' -> 0 ->> 'id')::uuid from res where k = 'abre4'), 'chave-equipe-0009',
  '[{"product_id":"00000000-0000-4000-8000-0000000004f2","quantity":1}]') $$, 'JMC01', null,
  'mesa em contingência não recebe pedido do tablet');

-- Modo de comanda (JM-200): trocar o modo não afeta a abertura viva, e a próxima copia o novo.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000402","role":"authenticated"}';
select lives_ok($$ select admin_set_tab_mode('00000000-0000-4000-8000-0000000004a1', 'nomeada') $$,
  'o gestor troca o modo de comanda com mesa aberta');
set local role anon;
select is((tablet_open_session(pg_temp.h('fe-a1')) ->> 'tab_mode'), 'mesa_unica',
  'a abertura viva segue no modo em que nasceu (JM-200)');
select throws_ok($$ select tablet_create_tab(pg_temp.h('fe-a1'), 'Ana') $$, 'JMT05', null,
  'abertura mesa_unica não cria comanda com nome, mesmo com a loja já em nomeada');
set local role authenticated;
select lives_ok($$ select staff_force_close_session((select (j ->> 'session_id')::uuid from res where k = 'abre4'), 'troca de modo') $$,
  'o gestor fecha a mesa');
set local role anon;
select is((tablet_open_session(pg_temp.h('fe-a1')) ->> 'tab_mode'), 'nomeada',
  'a abertura seguinte copia o modo novo da loja');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000403","role":"authenticated"}';
select throws_ok($$ select admin_set_tab_mode('00000000-0000-4000-8000-0000000004a1', 'nomeada') $$, 'JM403', null,
  'garçom não troca o modo de comanda');

reset role;
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select throws_ok($$ select staff_decide_cancel_request((select (j ->> 'request_id')::uuid from res where k = 'r2'), true, null) $$,
  '42501', null, 'o cliente não decide o próprio pedido de cancelamento (§9.4)');

select * from finish();
rollback;
