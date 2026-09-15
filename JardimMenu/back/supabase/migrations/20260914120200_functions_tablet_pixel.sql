-- Jardim Menu, functions do tablet e do pixel.
-- As do tablet recebem o hash do device_token e recusam no banco (JM-100, JM-180).
-- Nesta fase elas só LEEM: pedido, sessão de mesa e sacola não existem (prompt 2).
-- A única escrita anônima é track_events (regra 1 do CLAUDE.md).

begin;

-- ============================================================
-- 1. Janela aberta agora, no fuso da loja (D12, JM-006)
-- ============================================================

create function jm_windows_open(p_windows jsonb, p_tz text, p_now timestamptz)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $fn$
declare
  v_local timestamp;
  v_dow int;
  v_min int;
  w jsonb;
  v_open int;
  v_close int;
begin
  if p_windows is null then
    return true;
  end if;

  v_local := p_now at time zone p_tz;
  v_dow := extract(dow from v_local)::int;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

  for w in select * from jsonb_array_elements(p_windows) loop
    v_open := split_part(w ->> 'open', ':', 1)::int * 60 + split_part(w ->> 'open', ':', 2)::int;
    v_close := split_part(w ->> 'close', ':', 1)::int * 60 + split_part(w ->> 'close', ':', 2)::int;

    if (w ->> 'dow')::int = v_dow
       and ((v_close > v_open and v_min >= v_open and v_min < v_close)
            or (v_close < v_open and v_min >= v_open)) then
      return true;
    end if;
    if (w ->> 'dow')::int = (v_dow + 6) % 7 and v_close < v_open and v_min < v_close then
      return true;
    end if;
  end loop;

  return false;
end;
$fn$;

-- ============================================================
-- 2. Tablet (JM-180, JM-181, JM-003, JM-005, JM-031)
-- ============================================================

-- Confirma o pareamento: a tela de setup mostra loja e mesa antes de guardar o token.
create function tablet_resolve_device(p_token_hash text)
returns table (store_slug text, store_name text, table_number int, device_name text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
begin
  v := jm_device_by_hash(p_token_hash);

  return query
    select s.slug, s.name, t.number, v.name
      from public.stores s
      left join public.tables t on t.id = v.table_id
     where s.id = v.store_id;
end;
$fn$;

-- Cardápio da loja do dispositivo. O código do PDV nunca sai para o cliente (JM-190), e
-- produto fora da janela de disponibilidade não aparece (JM-006).
create function tablet_menu(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
  v_menu jsonb;
begin
  v := jm_device_by_hash(p_token_hash);

  select jsonb_build_object(
    'store', jsonb_build_object(
      'id', s.id, 'slug', s.slug, 'name', s.name, 'timezone', s.timezone,
      'business_day_start', to_char(s.business_day_start, 'HH24:MI'),
      'opening_hours', s.opening_hours, 'tab_mode', s.tab_mode, 'logo_url', s.logo_url,
      'primary_color', s.primary_color, 'accent_color', s.accent_color
    ),
    'table_number', (select t.number from public.tables t where t.id = v.table_id),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'store_id', c.store_id, 'name', c.name,
               'sort_order', c.sort_order, 'is_active', c.is_active
             ) order by c.sort_order, c.name)
        from public.categories c
       where c.store_id = s.id and c.is_active
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'store_id', p.store_id, 'category_id', p.category_id,
               'name', p.name, 'description', p.description, 'price', p.price,
               'photo_path', p.photo_path, 'emoji', p.emoji, 'is_featured', p.is_featured,
               'is_available', p.is_available, 'unavailable_since', p.unavailable_since,
               'available_window', p.available_window, 'pdv_code', null,
               'sort_order', p.sort_order,
               'option_groups', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', g.id, 'name', g.name, 'min_select', g.min_select,
                          'max_select', g.max_select, 'sort_order', pog.sort_order,
                          'options', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'id', o.id, 'group_id', o.group_id, 'name', o.name,
                                     'price_delta', o.price_delta, 'is_available', o.is_available,
                                     'sort_order', o.sort_order
                                   ) order by o.sort_order, o.name)
                              from public.options o
                             where o.group_id = g.id
                          ), '[]'::jsonb)
                        ) order by pog.sort_order)
                   from public.product_option_groups pog
                   join public.option_groups g on g.id = pog.group_id
                  where pog.product_id = p.id
               ), '[]'::jsonb)
             ) order by p.sort_order, p.name)
        from public.products p
        join public.categories c2 on c2.id = p.category_id and c2.is_active
       where p.store_id = s.id
         and p.is_active
         and jm_windows_open(p.available_window, s.timezone, now())
    ), '[]'::jsonb)
  )
    into v_menu
    from public.stores s
   where s.id = v.store_id;

  return v_menu;
end;
$fn$;

create function tablet_store_hours(p_token_hash text)
returns table (is_open boolean, opens_at_local text, opens_day_offset int, closes_at_local text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
begin
  v := jm_device_by_hash(p_token_hash);
  return query select * from store_hours_state(v.store_id, now());
end;
$fn$;

-- Total do item calculado no banco (regra 6, JM-031). O cliente manda produto, quantidade
-- e opções; preço nunca vem de fora. As regras do JM-003 são conferidas aqui também.
create function tablet_item_total(
  p_token_hash text,
  p_product_id uuid,
  p_quantity int,
  p_option_ids uuid[]
)
returns table (unit_total numeric, line_total numeric)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
  v_prod public.products;
  v_ids uuid[];
  v_grupo record;
  v_delta numeric;
begin
  v := jm_device_by_hash(p_token_hash);

  select * into v_prod
    from public.products p
   where p.id = p_product_id and p.store_id = v.store_id and p.is_active;
  if not found then
    raise exception 'produto nao encontrado' using errcode = 'JM404';
  end if;
  if not v_prod.is_available then
    raise exception 'produto indisponivel: %', v_prod.name using errcode = 'JM451';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then
    raise exception 'quantidade fora do limite' using errcode = 'JM422';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_option_ids, '{}')) x;

  -- Toda opção precisa ser de um grupo ligado a este produto, e estar disponível.
  if exists (
    select 1 from unnest(v_ids) oid
     where not exists (
       select 1
         from public.options o
         join public.product_option_groups pog on pog.group_id = o.group_id
        where o.id = oid and pog.product_id = p_product_id and o.is_available
     )
  ) then
    raise exception 'opcao invalida ou indisponivel para este produto' using errcode = 'JM422';
  end if;

  -- Mínimo e máximo de cada grupo (JM-003).
  for v_grupo in
    select g.name, g.min_select, g.max_select,
           (select count(*) from public.options o where o.group_id = g.id and o.id = any (v_ids)) as escolhidas
      from public.product_option_groups pog
      join public.option_groups g on g.id = pog.group_id
     where pog.product_id = p_product_id
  loop
    if v_grupo.escolhidas < v_grupo.min_select or v_grupo.escolhidas > v_grupo.max_select then
      raise exception 'escolha fora do limite no grupo %', v_grupo.name using errcode = 'JM422';
    end if;
  end loop;

  select coalesce(sum(o.price_delta), 0) into v_delta from public.options o where o.id = any (v_ids);

  return query select v_prod.price + v_delta, (v_prod.price + v_delta) * p_quantity;
end;
$fn$;

-- Pareamento (JM-180, decisão de 14/09/2026). O tablet apresenta o código de uso único do
-- QR; a rota gera o token permanente e manda só o hash dos dois. Código vencido, já usado
-- ou de dispositivo que não está ativo dão o MESMO erro, para não dizer a um estranho que
-- um código existe. É a segunda escrita anônima do sistema, e quem a autoriza é o código,
-- gerado por um gestor logado.
create function tablet_pair_device(p_pairing_code_hash text, p_token_hash text)
returns table (store_slug text, store_name text, table_number int, device_name text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
begin
  if p_pairing_code_hash is null or p_pairing_code_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'codigo de pareamento invalido' using errcode = 'JM401';
  end if;

  select * into v
    from public.devices d
   where d.pairing_code_hash = p_pairing_code_hash
   for update;

  if not found or v.status <> 'active' or v.pairing_expires_at < now() then
    raise exception 'codigo de pareamento invalido' using errcode = 'JM401';
  end if;

  update public.devices
     set token_hash = p_token_hash, pairing_code_hash = null, pairing_expires_at = null
   where id = v.id;

  return query
    select s.slug, s.name, t.number, v.name
      from public.stores s
      left join public.tables t on t.id = v.table_id
     where s.id = v.store_id;
end;
$fn$;

-- ============================================================
-- 3. Pixel (JM-061, JM-063)
-- ============================================================

-- A única escrita anônima do sistema. Limite de 50 por lote e 600 por sessão por minuto:
-- o excedente é descartado e contado, sem erro e sem punir a sessão. Evento com tipo
-- desconhecido, referência de outra loja ou campo malformado também é descartado.
-- menu_events não tem coluna de pessoa, então nenhum evento carrega dado pessoal.
create function track_events(p_session_id uuid, p_store_id uuid, p_events jsonb)
returns table (aceitos int, descartados int)
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_total int;
  v_sessao public.menu_sessions;
  v_restante int;
  v_aceitos int := 0;
  e jsonb;
  v_prod uuid;
  v_cat uuid;
  v_ms int;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_session_id is null or p_store_id is null or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'lote de eventos invalido' using errcode = 'JM422';
  end if;
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.is_active) then
    raise exception 'loja nao encontrada' using errcode = 'JM404';
  end if;

  v_total := jsonb_array_length(p_events);

  insert into public.menu_sessions (id, store_id) values (p_session_id, p_store_id)
  on conflict (id) do nothing;

  select * into v_sessao from public.menu_sessions ms where ms.id = p_session_id for update;
  if v_sessao.store_id <> p_store_id then
    raise exception 'sessao de pixel de outra loja' using errcode = 'JM409';
  end if;

  if now() - v_sessao.rate_window_start > interval '60 seconds' then
    update public.menu_sessions set rate_window_start = now(), rate_window_count = 0
     where id = p_session_id;
    v_sessao.rate_window_count := 0;
  end if;

  v_restante := greatest(0, least(50, 600 - v_sessao.rate_window_count));

  for e in select value from jsonb_array_elements(p_events) limit v_restante loop
    if jsonb_typeof(e) <> 'object'
       or (e ->> 'event_type') is null
       or (e ->> 'event_type') not in (
         'page_view', 'category_view', 'product_impression', 'product_view_time',
         'product_click', 'add_to_cart', 'cart_open', 'order_submitted', 'waiter_call'
       ) then
      continue;
    end if;

    v_prod := null;
    v_cat := null;
    v_ms := null;

    if e ? 'product_id' then
      if (e ->> 'product_id') !~* c_uuid then continue; end if;
      select p.id into v_prod from public.products p
       where p.id = (e ->> 'product_id')::uuid and p.store_id = p_store_id;
      if v_prod is null then continue; end if;
    end if;

    if e ? 'category_id' then
      if (e ->> 'category_id') !~* c_uuid then continue; end if;
      select c.id into v_cat from public.categories c
       where c.id = (e ->> 'category_id')::uuid and c.store_id = p_store_id;
      if v_cat is null then continue; end if;
    end if;

    if e ? 'value_ms' then
      if jsonb_typeof(e -> 'value_ms') <> 'number'
         or (e ->> 'value_ms') !~ '^[0-9]{1,6}$' then
        continue;
      end if;
      v_ms := (e ->> 'value_ms')::int;
    end if;

    insert into public.menu_events (session_id, store_id, event_type, product_id, category_id, value_ms)
    values (p_session_id, p_store_id, e ->> 'event_type', v_prod, v_cat, v_ms);

    v_aceitos := v_aceitos + 1;
  end loop;

  update public.menu_sessions
     set rate_window_count = rate_window_count + v_aceitos
   where id = p_session_id;

  return query select v_aceitos, v_total - v_aceitos;
end;
$fn$;

-- ============================================================
-- 4. Quem executa o quê
-- ============================================================

revoke execute on function jm_windows_open(jsonb, text, timestamptz) from public, anon, authenticated;
revoke execute on function tablet_resolve_device(text) from public, anon, authenticated;
revoke execute on function tablet_menu(text) from public, anon, authenticated;
revoke execute on function tablet_store_hours(text) from public, anon, authenticated;
revoke execute on function tablet_item_total(text, uuid, int, uuid[]) from public, anon, authenticated;
revoke execute on function track_events(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function tablet_pair_device(text, text) from public, anon, authenticated;

-- O tablet não é usuário autenticado: a rota chama com a chave anon.
grant execute on function tablet_resolve_device(text) to anon, authenticated;
grant execute on function tablet_menu(text) to anon, authenticated;
grant execute on function tablet_store_hours(text) to anon, authenticated;
grant execute on function tablet_item_total(text, uuid, int, uuid[]) to anon, authenticated;
grant execute on function track_events(uuid, uuid, jsonb) to anon, authenticated;
grant execute on function tablet_pair_device(text, text) to anon, authenticated;

commit;
