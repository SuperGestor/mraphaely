-- Jardim Menu, migração base da primeira versão.
-- Fonte: docs/PLANO-SCHEMA.md e docs/REQUISITOS-v1.8.md, aprovados em 11/09/2026.
-- O banco nasce vazio (§8.1): sem alter table, sem backfill, sem padrão de três passos.
-- Ordem de criação: §4 do PLANO-SCHEMA. Roda inteira em uma transação.
-- Toda tabela nasce com RLS ativa (NF-005), e não existe policy de escrita (regra 2).

begin;

-- O Supabase concede, por privilégio padrão, tudo o que nasce no schema public a anon e a
-- authenticated: tabela, sequência e function. Aqui isso é desligado para o papel que roda
-- as migrações, também para as migrações futuras. Todo privilégio passa a ser nominal, e
-- o que não foi concedido não existe (NF-005, NF-006, regra 2).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ============================================================
-- 1. Organização, loja e usuários da loja
-- ============================================================

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint organizations_name_ck check (length(trim(name)) between 1 and 80)
);
alter table organizations enable row level security;

-- Sem plano nem limites de cobrança, por decisão (A2).
create table stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  slug text not null,
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  business_day_start time not null default '04:00',
  opening_hours jsonb,
  tab_mode text not null default 'mesa_unica',
  logo_url text,
  primary_color text not null default '#2f3927',
  accent_color text not null default '#5a6b4a',
  idle_table_alert_minutes int not null default 180,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint stores_slug_uq unique (slug),
  constraint stores_slug_ck check (slug ~ '^[a-z0-9-]{2,40}$'),
  constraint stores_name_ck check (length(trim(name)) between 1 and 22),
  constraint stores_tab_mode_ck check (tab_mode in ('mesa_unica', 'nomeada')),
  constraint stores_primary_color_ck check (primary_color ~* '^#[0-9a-f]{6}$'),
  constraint stores_accent_color_ck check (accent_color ~* '^#[0-9a-f]{6}$'),
  constraint stores_idle_alert_ck check (idle_table_alert_minutes between 30 and 1440)
);
create index stores_by_org on stores (organization_id);
alter table stores enable row level security;

-- Fronteira do turno (D12, JM-053, JM-140). ÚNICA definição: escrita e relatório usam
-- esta function. Criada depois de stores, porque o corpo é validado na criação, e essa
-- ordem era o defeito 4.1 do diagnóstico. Loja inexistente levanta erro próprio, em vez
-- de devolver NULL em silêncio (defeito 4.8).
create function shift_date(ts timestamptz, p_store_id uuid)
returns date
language plpgsql
stable
set search_path = pg_catalog, public
as $fn$
declare
  v_tz text;
  v_start time;
begin
  select s.timezone, s.business_day_start
    into v_tz, v_start
    from public.stores s
   where s.id = p_store_id;

  if v_tz is null then
    raise exception 'loja % nao encontrada', p_store_id using errcode = 'JM404';
  end if;

  return (((ts at time zone v_tz) - v_start::interval))::date;
end;
$fn$;

create table store_users (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  is_active boolean not null default true,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint store_users_uq unique (store_id, user_id),
  constraint store_users_role_ck check (role in ('owner', 'manager', 'waiter', 'kitchen')),
  constraint store_users_inactive_ck check (is_active or deactivated_at is not null)
);
create index store_users_by_user on store_users (user_id) where is_active;
alter table store_users enable row level security;

-- Papel do usuário autenticado naquela loja, ou nulo. Apoia toda policy de leitura.
create function jm_role(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select su.role
    from public.store_users su
   where su.store_id = p_store_id
     and su.user_id = auth.uid()
     and su.is_active
   limit 1
$fn$;

-- ============================================================
-- 2. Cardápio (JM-001 a JM-004, JM-006, JM-190)
-- ============================================================

create table categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint categories_name_ck check (length(trim(name)) between 1 and 40),
  constraint categories_name_uq unique (store_id, name)
);
create index categories_by_store_order on categories (store_id, sort_order);
alter table categories enable row level security;

create table products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  category_id uuid not null references categories(id) on delete restrict,
  name text not null,
  description text,
  price numeric(10,2) not null,
  photo_path text,
  emoji text,
  is_featured boolean not null default false,
  is_available boolean not null default true,
  unavailable_since timestamptz,
  unavailable_by uuid references store_users(id),
  available_window jsonb,
  pdv_code text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint products_name_ck check (length(trim(name)) between 1 and 80),
  constraint products_price_ck check (price >= 0),
  constraint products_desc_ck check (description is null or length(description) <= 280),
  constraint products_unavailable_ck check (
    is_available
    or (unavailable_since is not null and unavailable_by is not null)
  )
);
create index products_by_store_category on products (store_id, category_id, sort_order);
create index products_featured on products (store_id) where is_featured and is_active;
alter table products enable row level security;

create table option_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  min_select int not null default 0,
  max_select int not null default 1,
  created_at timestamptz not null default now(),
  constraint option_groups_name_ck check (length(trim(name)) between 1 and 40),
  constraint option_groups_min_ck check (min_select >= 0),
  constraint option_groups_max_ck check (max_select >= 1),
  constraint option_groups_range_ck check (min_select <= max_select)
);
create index option_groups_by_store on option_groups (store_id);
alter table option_groups enable row level security;

-- price_delta >= 0 é o valor provisório do plano (§12, ponto 1, adiado pelo PO).
create table options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references option_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(10,2) not null default 0,
  pdv_code text,
  is_available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint options_name_ck check (length(trim(name)) between 1 and 40),
  constraint options_delta_ck check (price_delta >= 0)
);
create index options_by_group on options (group_id, sort_order);
alter table options enable row level security;

create table product_option_groups (
  product_id uuid not null references products(id) on delete cascade,
  group_id uuid not null references option_groups(id) on delete cascade,
  sort_order int not null default 0,
  primary key (product_id, group_id)
);
create index product_option_groups_by_group on product_option_groups (group_id);
alter table product_option_groups enable row level security;

-- ============================================================
-- 3. Mesas e dispositivos (JM-051, JM-180, JM-184, JM-186)
-- ============================================================

create table tables (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  number int not null,
  label text,
  -- Plaquinha do Módulo O, na Fase C (D21). Hoje sem uso, e fora de toda leitura (NF-006).
  qr_token text not null default replace(gen_random_uuid()::text, '-', ''),
  -- Contingência fica na mesa, e não no tablet, para sobreviver à troca de aparelho (JM-186).
  ordering_enabled boolean not null default true,
  ordering_changed_by uuid references store_users(id),
  ordering_changed_at timestamptz,
  ordering_disabled_reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint tables_number_uq unique (store_id, number),
  constraint tables_qr_token_uq unique (qr_token),
  constraint tables_number_ck check (number > 0),
  constraint tables_ordering_ck check (
    ordering_enabled
    or (ordering_changed_by is not null
        and ordering_changed_at is not null
        and ordering_disabled_reason is not null)
  )
);
create index tables_by_store on tables (store_id, number);
alter table tables enable row level security;

create table devices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  table_id uuid references tables(id) on delete restrict,
  name text not null,
  -- sha256 do token permanente. Nulo até o tablet parear: o token nasce no pareamento, e
  -- não no provisionamento, então a tela do admin nunca vê o token (decisão de 14/09/2026).
  token_hash text,
  -- sha256 do código de uso único que o QR de configuração carrega: vale 10 minutos e uma
  -- leitura, e o pareamento apaga os dois campos.
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  -- Derivado, e não secreto: a tela do admin mostra se o tablet já pareou (JM-180) sem
  -- ler hash nem código.
  is_paired boolean generated always as (token_hash is not null) stored,
  kind text not null default 'tablet',
  status text not null default 'active',
  app_version text,
  battery_level int,
  last_seen_at timestamptz,
  provisioned_by uuid references store_users(id),
  provisioned_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references store_users(id),
  constraint devices_token_uq unique (token_hash),
  constraint devices_pairing_uq unique (pairing_code_hash),
  constraint devices_credential_ck check (token_hash is not null or pairing_code_hash is not null),
  constraint devices_pairing_ck check ((pairing_code_hash is null) = (pairing_expires_at is null)),
  constraint devices_name_ck check (length(trim(name)) between 1 and 40),
  constraint devices_kind_ck check (kind in ('tablet')),
  constraint devices_status_ck check (status in ('active', 'inactive', 'retired')),
  constraint devices_battery_ck check (battery_level is null or battery_level between 0 and 100),
  constraint devices_retired_ck check (
    status <> 'retired' or (retired_at is not null and retired_by is not null)
  )
);
-- Um dispositivo ativo por mesa (JM-180): sem isso, duas aberturas na mesma mesa.
create unique index devices_one_active_per_table_ux
  on devices (table_id) where status = 'active' and table_id is not null;
create index devices_by_store on devices (store_id, status);
alter table devices enable row level security;

-- ============================================================
-- 4. Abertura de mesa e comandas (D1, D18, D26, JM-182, JM-200..203)
-- ============================================================

create table table_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  table_id uuid not null references tables(id) on delete restrict,
  -- Não existe 'closing' (D19) nem 'expired' (D26).
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  opened_by_device uuid references devices(id),
  opened_by_user uuid references store_users(id),
  closed_at timestamptz,
  close_kind text,
  closed_by uuid references store_users(id),
  close_reason text,
  constraint sessions_status_ck check (status in ('open', 'closed')),
  constraint sessions_opener_ck check (
    opened_by_device is not null or opened_by_user is not null
  ),
  constraint sessions_close_kind_ck check (
    close_kind is null or close_kind in ('all_tabs_done', 'manager_forced')
  ),
  constraint sessions_closed_ck check (
    (status = 'open' and closed_at is null and close_kind is null)
    or (status = 'closed' and closed_at is not null and close_kind is not null)
  ),
  constraint sessions_forced_ck check (
    close_kind is distinct from 'manager_forced'
    or (closed_by is not null and close_reason is not null)
  )
);
-- Uma abertura viva por mesa: premissa 2 da §12, garantida por índice e não por código.
create unique index table_sessions_one_open_ux
  on table_sessions (table_id) where status = 'open';
create index table_sessions_by_store_status on table_sessions (store_id, status);
create index table_sessions_by_device on table_sessions (opened_by_device);
alter table table_sessions enable row level security;

create table table_tabs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  -- Muda quando a comanda migra de mesa (D27, JM-209).
  table_session_id uuid not null references table_sessions(id) on delete restrict,
  name text not null,
  status text not null default 'open',
  origin text not null default 'tablet',
  opened_by_device uuid references devices(id),
  opened_by_user uuid references store_users(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  close_kind text,
  closed_by uuid references store_users(id),
  close_reason text,
  constraint tabs_name_ck check (length(trim(name)) between 1 and 24),
  constraint tabs_status_ck check (status in ('open', 'closed')),
  constraint tabs_origin_ck check (origin in ('tablet', 'staff')),
  constraint tabs_opener_ck check (
    opened_by_device is not null or opened_by_user is not null
  ),
  constraint tabs_close_kind_ck check (
    close_kind is null or close_kind in ('settled_outside', 'empty', 'manager_forced')
  ),
  constraint tabs_closed_ck check (
    (status = 'open' and closed_at is null and closed_by is null and close_kind is null)
    or (status = 'closed' and closed_at is not null and closed_by is not null
        and close_kind is not null)
  ),
  constraint tabs_forced_ck check (
    close_kind is distinct from 'manager_forced' or close_reason is not null
  )
);
-- Nome único só entre comandas abertas (JM-201, P6): a Maria que pagou pode voltar.
create unique index table_tabs_open_name_ux
  on table_tabs (table_session_id, lower(trim(name))) where status = 'open';
create index table_tabs_by_session on table_tabs (table_session_id, status);
alter table table_tabs enable row level security;

-- ============================================================
-- 5. Pedido, itens, status, cancelamento e migração de comanda
-- ============================================================

-- Número amigável por loja e por turno (JM-036). A function incrementa com trava de
-- linha, e orders_display_uq garante a unicidade.
create table order_number_counters (
  store_id uuid not null references stores(id) on delete cascade,
  business_date date not null,
  last_number int not null default 0,
  primary key (store_id, business_date),
  constraint order_counters_ck check (last_number >= 0)
);
alter table order_number_counters enable row level security;

create table orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  -- Abertura em que o pedido foi feito. NUNCA muda, nem quando a comanda migra (D27).
  table_session_id uuid not null references table_sessions(id) on delete restrict,
  tab_id uuid not null references table_tabs(id) on delete restrict,
  -- Na primeira versão só o tablet cria pedido. Vira opcional quando o JM-110 entrar.
  device_id uuid not null references devices(id) on delete restrict,
  status text not null default 'confirmed',
  idempotency_key text not null,
  business_date date not null,
  display_number int not null,
  subtotal numeric(10,2) not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references store_users(id),
  cancel_reason text,
  -- D25: não existe 'ready' no salão. Ele volta com o delivery.
  constraint orders_status_ck check (
    status in ('confirmed', 'preparing', 'delivered', 'cancelled')
  ),
  constraint orders_idem_ck check (length(idempotency_key) between 16 and 128),
  constraint orders_subtotal_ck check (subtotal >= 0),
  constraint orders_display_ck check (display_number > 0),
  -- Chave única por abertura de mesa (T5).
  constraint orders_idem_uq unique (table_session_id, idempotency_key),
  constraint orders_display_uq unique (store_id, business_date, display_number),
  constraint orders_cancel_ck check (
    status <> 'cancelled'
    or (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null)
  )
);
create index orders_by_tab on orders (tab_id, created_at);
create index orders_by_session on orders (table_session_id, created_at);
create index orders_by_store_date on orders (store_id, business_date);
alter table orders enable row level security;

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  -- Cópias do momento do pedido: é o que preserva o histórico quando o preço muda (D32).
  product_name text not null,
  unit_price numeric(10,2) not null,
  quantity int not null,
  notes text,
  line_total numeric(10,2) not null,
  removed_at timestamptz,
  removed_by uuid references store_users(id),
  remove_reason text,
  constraint items_qty_ck check (quantity > 0),
  constraint items_price_ck check (unit_price >= 0),
  constraint items_total_ck check (line_total >= 0),
  constraint items_notes_ck check (notes is null or length(notes) <= 140),
  constraint items_removed_ck check (
    (removed_at is null and removed_by is null and remove_reason is null)
    or (removed_at is not null and removed_by is not null and remove_reason is not null)
  )
);
create index order_items_by_order on order_items (order_id);
alter table order_items enable row level security;

create table order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  option_id uuid not null references options(id) on delete restrict,
  option_name text not null,
  price_delta numeric(10,2) not null default 0,
  constraint item_options_delta_ck check (price_delta >= 0),
  constraint item_options_uq unique (order_item_id, option_id)
);
create index order_item_options_by_item on order_item_options (order_item_id);
alter table order_item_options enable row level security;

-- Histórico de transições (JM-034). Na primeira versão há dois eventos: o nascimento,
-- pelo tablet, e o cancelamento, pela equipe.
create table order_status_events (
  id bigserial primary key,
  order_id uuid not null references orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_user_id uuid references store_users(id),
  actor_device_id uuid references devices(id),
  at timestamptz not null default now(),
  constraint events_from_ck check (
    from_status is null
    or from_status in ('confirmed', 'preparing', 'delivered', 'cancelled')
  ),
  constraint events_to_ck check (
    to_status in ('confirmed', 'preparing', 'delivered', 'cancelled')
  ),
  constraint events_actor_ck check (num_nonnulls(actor_user_id, actor_device_id) = 1)
);
create index order_status_events_by_order on order_status_events (order_id, at);
alter table order_status_events enable row level security;

-- Pedido de cancelamento pelo cliente (JM-111, D28). O cliente solicita; a equipe decide.
create table order_cancel_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  -- Nulo = pedido inteiro (P1, provisório).
  order_item_id uuid references order_items(id) on delete cascade,
  requested_by_device uuid not null references devices(id) on delete restrict,
  requested_at timestamptz not null default now(),
  status text not null default 'pending',
  decided_by uuid references store_users(id),
  decided_at timestamptz,
  decision_note text,
  constraint cancel_requests_status_ck check (
    status in ('pending', 'approved', 'rejected')
  ),
  constraint cancel_requests_decided_ck check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);
-- Dois toques não criam dois pedidos de cancelamento (JM-111).
create unique index order_cancel_requests_one_pending_ux
  on order_cancel_requests (order_id, order_item_id) nulls not distinct
  where status = 'pending';
create index order_cancel_requests_pending
  on order_cancel_requests (store_id, requested_at) where status = 'pending';
alter table order_cancel_requests enable row level security;

-- Migração de comanda entre mesas (JM-209, D27). Linha imutável.
create table tab_moves (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  tab_id uuid not null references table_tabs(id) on delete cascade,
  from_session_id uuid not null references table_sessions(id) on delete restrict,
  to_session_id uuid not null references table_sessions(id) on delete restrict,
  moved_by uuid not null references store_users(id) on delete restrict,
  moved_at timestamptz not null default now(),
  constraint tab_moves_distinct_ck check (from_session_id <> to_session_id)
);
create index tab_moves_by_tab on tab_moves (tab_id, moved_at);
alter table tab_moves enable row level security;

-- ============================================================
-- 6. Chamado de garçom e pixel (JM-038..040, JM-187, JM-060..064)
-- ============================================================

-- O chamado é da mesa, e funciona sem abertura de mesa (JM-187). O limite de 60 s por
-- mesa (JM-038) mora na function, com trava na linha da mesa.
create table waiter_calls (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  table_session_id uuid references table_sessions(id) on delete set null,
  device_id uuid references devices(id) on delete set null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references store_users(id),
  reinforced_at timestamptz,
  closed_at timestamptz,
  constraint waiter_calls_ack_ck check (
    (acknowledged_at is null and acknowledged_by is null)
    or (acknowledged_at is not null and acknowledged_by is not null)
  )
);
create index waiter_calls_by_table_created on waiter_calls (table_id, created_at desc);
create index waiter_calls_open on waiter_calls (store_id, created_at desc)
  where closed_at is null;
alter table waiter_calls enable row level security;

-- Pixel anônimo (JM-063): sem dispositivo, sem mesa e sem comanda.
create table menu_sessions (
  id uuid primary key,
  store_id uuid not null references stores(id) on delete cascade,
  started_at timestamptz not null default now(),
  rate_window_start timestamptz not null default now(),
  rate_window_count int not null default 0,
  constraint menu_sessions_window_ck check (rate_window_count >= 0)
);
create index menu_sessions_by_store on menu_sessions (store_id, started_at);
alter table menu_sessions enable row level security;

create table menu_events (
  id bigserial primary key,
  session_id uuid not null references menu_sessions(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  event_type text not null,
  product_id uuid references products(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  value_ms int,
  received_at timestamptz not null default now(),
  constraint menu_events_type_ck check (event_type in (
    'page_view', 'category_view', 'product_impression', 'product_view_time',
    'product_click', 'add_to_cart', 'cart_open', 'order_submitted', 'waiter_call'
  )),
  constraint menu_events_value_ck check (value_ms is null or value_ms >= 0)
);
create index menu_events_by_store_received on menu_events (store_id, received_at);
create index menu_events_by_product_type on menu_events (product_id, event_type);
alter table menu_events enable row level security;

-- Painel do JM-062. security_invoker: a view respeita a RLS de quem consulta.
create view product_engagement with (security_invoker = true) as
select p.store_id,
       p.id as product_id,
       p.name,
       count(*) filter (where e.event_type = 'product_impression') as impressions,
       count(*) filter (where e.event_type = 'product_click') as clicks,
       count(*) filter (where e.event_type = 'add_to_cart') as adds_to_cart,
       count(*) filter (where e.event_type = 'order_submitted') as order_submits
  from products p
  left join menu_events e on e.product_id = p.id
 group by p.store_id, p.id, p.name;

-- ============================================================
-- 7. Leitura sob RLS. Nenhuma policy de escrita, em nenhuma tabela (regra 2)
-- ============================================================

grant usage on schema public to anon, authenticated;

-- Guarda redundante do topo da migração: anon não lê nem escreve tabela nenhuma (NF-005,
-- NF-006), e authenticated só lê, sob RLS. Toda escrita é por function (regra 2). TRUNCATE
-- não passa por RLS, então também sai.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on table organizations, stores, store_users, categories, products,
  option_groups, options, product_option_groups, table_sessions, table_tabs, orders,
  order_items, order_item_options, order_status_events, order_cancel_requests,
  tab_moves, waiter_calls, menu_sessions, menu_events, product_engagement
  to authenticated;

-- O segredo sai da leitura por privilégio de coluna, e não por convenção (NF-006):
-- devices.token_hash e tables.qr_token não são legíveis por ninguém.
revoke select on table devices from authenticated;
grant select (id, store_id, table_id, name, kind, status, app_version, battery_level,
              last_seen_at, provisioned_by, provisioned_at, retired_at, retired_by,
              is_paired, pairing_expires_at)
  on table devices to authenticated;

revoke select on table tables from authenticated;
grant select (id, store_id, number, label, ordering_enabled, ordering_changed_by,
              ordering_changed_at, ordering_disabled_reason, is_active, created_at)
  on table tables to authenticated;

revoke execute on function shift_date(timestamptz, uuid) from public, anon, authenticated;
revoke execute on function jm_role(uuid) from public, anon, authenticated;
grant execute on function shift_date(timestamptz, uuid) to authenticated;
grant execute on function jm_role(uuid) to authenticated;

-- Policies de leitura, por papel da §4.
create policy organizations_read on organizations for select to authenticated
  using (exists (
    select 1 from stores s
     where s.organization_id = organizations.id and jm_role(s.id) is not null
  ));

create policy stores_read on stores for select to authenticated
  using (jm_role(id) is not null);

create policy store_users_read on store_users for select to authenticated
  using (user_id = auth.uid() or jm_role(store_id) in ('owner', 'manager'));

create policy categories_read on categories for select to authenticated
  using (jm_role(store_id) is not null);

create policy products_read on products for select to authenticated
  using (jm_role(store_id) is not null);

create policy option_groups_read on option_groups for select to authenticated
  using (jm_role(store_id) is not null);

create policy options_read on options for select to authenticated
  using (exists (
    select 1 from option_groups g
     where g.id = options.group_id and jm_role(g.store_id) is not null
  ));

create policy product_option_groups_read on product_option_groups for select to authenticated
  using (exists (
    select 1 from products p
     where p.id = product_option_groups.product_id and jm_role(p.store_id) is not null
  ));

create policy tables_read on tables for select to authenticated
  using (jm_role(store_id) is not null);

create policy devices_read on devices for select to authenticated
  using (jm_role(store_id) is not null);

create policy table_sessions_read on table_sessions for select to authenticated
  using (jm_role(store_id) is not null);

create policy table_tabs_read on table_tabs for select to authenticated
  using (jm_role(store_id) is not null);

create policy orders_read on orders for select to authenticated
  using (jm_role(store_id) is not null);

create policy order_items_read on order_items for select to authenticated
  using (exists (
    select 1 from orders o
     where o.id = order_items.order_id and jm_role(o.store_id) is not null
  ));

create policy order_item_options_read on order_item_options for select to authenticated
  using (exists (
    select 1 from order_items i
      join orders o on o.id = i.order_id
     where i.id = order_item_options.order_item_id and jm_role(o.store_id) is not null
  ));

create policy order_status_events_read on order_status_events for select to authenticated
  using (exists (
    select 1 from orders o
     where o.id = order_status_events.order_id and jm_role(o.store_id) is not null
  ));

create policy order_cancel_requests_read on order_cancel_requests for select to authenticated
  using (jm_role(store_id) is not null);

create policy tab_moves_read on tab_moves for select to authenticated
  using (jm_role(store_id) is not null);

create policy waiter_calls_read on waiter_calls for select to authenticated
  using (jm_role(store_id) is not null);

-- Pixel e painel: só dono e gestor (JM-062).
create policy menu_sessions_read on menu_sessions for select to authenticated
  using (jm_role(store_id) in ('owner', 'manager'));

create policy menu_events_read on menu_events for select to authenticated
  using (jm_role(store_id) in ('owner', 'manager'));

commit;
