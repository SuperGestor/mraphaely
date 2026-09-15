-- Jardim Menu, massa de desenvolvimento (§9 do PLANO-SCHEMA).
--
-- SÓ para o Supabase local (`supabase db reset`). Dados fictícios, senha fictícia e
-- nenhum dado de cliente. Nunca rodar em staging nem em produção.
--
-- Usuários de teste, todos com a senha fictícia `jardim-local-123`:
--   dono@jardim.local        dono do Jardim Secreto
--   gestor@jardim.local      gestor do Jardim Secreto
--   garcom@jardim.local      garçom do Jardim Secreto
--   gestor@confraria.local   gestor da Confraria (a outra loja, para o teste de isolamento)
--
-- Dispositivos não entram aqui: eles nascem pelo fluxo de provisionamento e pareamento,
-- que é o que o teste ponta a ponta exercita.

-- ---------- usuários do Auth ----------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('jardim-local-123', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
       '', '', '', ''
  from (values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'dono@jardim.local'),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'gestor@jardim.local'),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'garcom@jardim.local'),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'gestor@confraria.local')
  ) as u(id, email);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
 where u.email like '%.local';

-- ---------- organização, lojas e papéis ----------
insert into organizations (id, name) values ('20000000-0000-4000-8000-000000000001', 'Grupo piloto');

-- Jardim Secreto sem restrição de horário, para o fluxo de pedido não depender do relógio.
insert into stores (id, organization_id, slug, name, opening_hours) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'jardim-secreto', 'Jardim Secreto', null),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'confraria', 'Confraria',
   '[{"dow":5,"open":"18:00","close":"02:00"},{"dow":6,"open":"12:00","close":"02:00"}]');

insert into store_users (store_id, user_id, role) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'manager'),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'waiter'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004', 'manager');

-- ---------- cardápio do Jardim Secreto ----------
insert into categories (id, store_id, name, sort_order) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Para começar', 1),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Da brasa', 2),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'Chopp e cerveja', 3);

insert into products (id, store_id, category_id, name, description, price, emoji, is_featured, pdv_code, sort_order) values
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Bolinho de mandioca', 'Oito unidades, com maionese de limão queimado.', 32.00, '🥟', true, 'PDV-1002', 1),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Pão de fermentação natural', 'Pão do dia, manteiga de ervas e flor de sal.', 24.00, '🍞', false, 'PDV-1001', 2),
  ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'Ancho na brasa', '300g, na grelha de carvão, com acompanhamento.', 92.00, '🥩', true, 'PDV-1201', 3),
  ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'Burger do jardim', '180g de blend da casa e queijo meia cura.', 54.00, '🍔', false, 'PDV-1301', 4),
  ('50000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'Chopp Pilsen da casa', 'Leve e seco.', 16.00, '🍺', true, 'PDV-1401', 5);

insert into option_groups (id, store_id, name, min_select, max_select) values
  ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Ponto da carne', 1, 1),
  ('60000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Adicionais', 0, 2);

insert into options (id, group_id, name, price_delta, pdv_code, is_available, sort_order) values
  ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'Ao ponto', 0, null, true, 1),
  ('70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', 'Bem passada', 0, null, true, 2),
  ('70000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000002', 'Bacon artesanal', 8.00, 'PDV-B1', true, 1),
  ('70000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000002', 'Queijo da serra', 6.00, 'PDV-B2', true, 2),
  ('70000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000002', 'Ovo caipira', 4.00, null, false, 3);

insert into product_option_groups (product_id, group_id, sort_order) values
  ('50000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', 1),
  ('50000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000001', 1),
  ('50000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000002', 2);

-- ---------- mesas ----------
insert into tables (store_id, number, label)
select '30000000-0000-4000-8000-000000000001', n, case when n <= 6 then 'Jardim ' || n else 'Varanda ' || (n - 6) end
  from generate_series(1, 10) as n;

insert into tables (store_id, number) values ('30000000-0000-4000-8000-000000000002', 1);

-- ---------- a outra loja ----------
insert into categories (id, store_id, name, sort_order) values
  ('40000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000002', 'Vinhos', 1);
insert into products (store_id, category_id, name, price, sort_order) values
  ('30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000009', 'Vinho da Confraria', 60.00, 1);
