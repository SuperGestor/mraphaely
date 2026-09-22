-- Jardim Menu, pareamento do tablet com login da equipe (JM-180, decisão de 21/09/2026).
-- Só o dono e o gestor pareiam; parear de novo a mesma mesa aposenta o tablet anterior;
-- nenhum papel anônimo alcança o pareamento. Tudo numa transação desfeita no fim.

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- ---------- massa ----------
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-000000000101', 'dono@p.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000102', 'gestor@p.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000103', 'garcom@p.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000104', 'gestor@q.test', 'authenticated', 'authenticated');

insert into organizations (id, name) values ('00000000-0000-4000-8000-0000000001a0', 'Org P');
insert into stores (id, organization_id, slug, name) values
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001a0', 'loja-p', 'Loja P'),
  ('00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-0000000001a0', 'loja-q', 'Loja Q');
insert into store_users (store_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-000000000101', 'owner'),
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-000000000102', 'manager'),
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-000000000103', 'waiter'),
  ('00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-000000000104', 'manager');
insert into tables (id, store_id, number) values
  ('00000000-0000-4000-8000-0000000001e1', '00000000-0000-4000-8000-0000000001a1', 1),
  ('00000000-0000-4000-8000-0000000001e2', '00000000-0000-4000-8000-0000000001b1', 1);

-- ---------- papel ----------
set local role authenticated;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated"}';
select throws_ok(
  $$ select * from staff_pair_device('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001e1',
                                     'Tablet', encode(sha256('t1'::bytea), 'hex')) $$,
  'JM403', null, 'garçom não pareia tablet'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000104","role":"authenticated"}';
select throws_ok(
  $$ select * from staff_pair_device('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001e1',
                                     'Tablet', encode(sha256('t1'::bytea), 'hex')) $$,
  'JM403', null, 'gestor de outra loja não pareia tablet'
);
select throws_ok(
  $$ select * from staff_pair_device('00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-0000000001e1',
                                     'Tablet', encode(sha256('t1'::bytea), 'hex')) $$,
  'JM404', null, 'mesa de outra loja não é pareada'
);

-- ---------- pareamento e troca de tablet ----------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated"}';
select throws_ok(
  $$ select * from staff_pair_device('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001e1',
                                     'Tablet', 'nao-e-um-hash') $$,
  'JM422', null, 'hash de token fora do formato é recusado'
);
select is(
  (select table_number from staff_pair_device('00000000-0000-4000-8000-0000000001a1',
     '00000000-0000-4000-8000-0000000001e1', 'Tablet mesa 1', encode(sha256('t1'::bytea), 'hex'))),
  1,
  'gestor pareia o tablet da mesa 1'
);
select is(
  (select table_number from staff_pair_device('00000000-0000-4000-8000-0000000001a1',
     '00000000-0000-4000-8000-0000000001e1', 'Tablet mesa 1, troca', encode(sha256('t2'::bytea), 'hex'))),
  1,
  'parear de novo a mesma mesa troca o tablet'
);

reset role;
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;
select throws_ok(
  $$ select tablet_menu(encode(sha256('t1'::bytea), 'hex')) $$,
  'JM410', null, 'o token do tablet substituído é recusado'
);
select lives_ok(
  $$ select tablet_menu(encode(sha256('t2'::bytea), 'hex')) $$,
  'o token novo lê o cardápio'
);
select throws_ok(
  $$ select * from staff_pair_device('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001e1',
                                     'Tablet', encode(sha256('t3'::bytea), 'hex')) $$,
  '42501', null, 'anon não alcança o pareamento'
);

select * from finish();
rollback;
