-- Jardim Menu, functions do admin: cardápio, mesas, dispositivos e usuários da loja.
-- Todas exigem login e papel (§4), e todas gravam autor quando o documento pede.

begin;

-- Janela de horário no formato fechado de opening_hours (JM-005, JM-006).
create function jm_windows_valid(p_windows jsonb)
returns boolean
language sql
immutable
as $fn$
  select p_windows is null
      or (jsonb_typeof(p_windows) = 'array'
          and not exists (
            select 1
              from jsonb_array_elements(p_windows) e
             where jsonb_typeof(e) <> 'object'
                or not (e ? 'dow' and e ? 'open' and e ? 'close')
                or (e ->> 'dow') !~ '^[0-6]$'
                or (e ->> 'open') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                or (e ->> 'close') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                or (e ->> 'open') = (e ->> 'close')
          ))
$fn$;

-- Traduz violação de unicidade em erro de regra com código estável.
-- (Chamado dentro dos blocos de exceção abaixo.)

-- ============================================================
-- 1. Categorias (JM-001, JM-050)
-- ============================================================

create function admin_upsert_category(
  p_store_id uuid,
  p_id uuid,
  p_name text,
  p_sort_order int,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_id uuid;
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  if p_id is null then
    insert into public.categories (store_id, name, sort_order, is_active)
    values (p_store_id, trim(p_name), coalesce(p_sort_order, 0), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.categories
       set name = trim(p_name),
           sort_order = coalesce(p_sort_order, sort_order),
           is_active = coalesce(p_is_active, is_active)
     where id = p_id and store_id = p_store_id
    returning id into v_id;
    if v_id is null then
      raise exception 'categoria nao encontrada nesta loja' using errcode = 'JM404';
    end if;
  end if;

  return v_id;
exception
  when unique_violation then
    raise exception 'ja existe categoria com esse nome' using errcode = 'JM409';
  when check_violation then
    raise exception 'nome de categoria invalido' using errcode = 'JM422';
end;
$fn$;

-- ============================================================
-- 2. Produtos (JM-002, JM-006, JM-050, JM-190)
-- ============================================================

create function admin_upsert_product(
  p_store_id uuid,
  p_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_emoji text,
  p_is_featured boolean,
  p_available_window jsonb,
  p_pdv_code text,
  p_sort_order int,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_id uuid;
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  if not exists (select 1 from public.categories c where c.id = p_category_id and c.store_id = p_store_id) then
    raise exception 'categoria nao pertence a esta loja' using errcode = 'JM422';
  end if;
  if not jm_windows_valid(p_available_window) then
    raise exception 'janela de disponibilidade em formato invalido' using errcode = 'JM422';
  end if;

  if p_id is null then
    insert into public.products (
      store_id, category_id, name, description, price, emoji, is_featured,
      available_window, pdv_code, sort_order, is_active
    )
    values (
      p_store_id, p_category_id, trim(p_name), nullif(trim(p_description), ''), round(p_price, 2),
      nullif(trim(p_emoji), ''), coalesce(p_is_featured, false), p_available_window,
      nullif(trim(p_pdv_code), ''), coalesce(p_sort_order, 0), coalesce(p_is_active, true)
    )
    returning id into v_id;
  else
    update public.products
       set category_id = p_category_id,
           name = trim(p_name),
           description = nullif(trim(p_description), ''),
           price = round(p_price, 2),
           emoji = nullif(trim(p_emoji), ''),
           is_featured = coalesce(p_is_featured, is_featured),
           available_window = p_available_window,
           pdv_code = nullif(trim(p_pdv_code), ''),
           sort_order = coalesce(p_sort_order, sort_order),
           is_active = coalesce(p_is_active, is_active)
     where id = p_id and store_id = p_store_id
    returning id into v_id;
    if v_id is null then
      raise exception 'produto nao encontrado nesta loja' using errcode = 'JM404';
    end if;
  end if;

  return v_id;
exception
  when check_violation then
    raise exception 'produto com campo invalido' using errcode = 'JM422';
end;
$fn$;

-- Chamada pela rota de upload depois que as três larguras foram gravadas no Storage.
create function admin_set_product_photo(p_product_id uuid, p_photo_path text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_store uuid;
begin
  select p.store_id into v_store from public.products p where p.id = p_product_id;
  if v_store is null then
    raise exception 'produto nao encontrado' using errcode = 'JM404';
  end if;
  perform jm_require_role(v_store, array['owner', 'manager']);

  -- O caminho é sempre dentro da pasta da loja: nenhum produto aponta para foto alheia.
  if p_photo_path is not null and p_photo_path !~ ('^' || v_store::text || '/[0-9a-f-]{36}/[a-z0-9-]+$') then
    raise exception 'caminho de foto invalido' using errcode = 'JM422';
  end if;

  update public.products set photo_path = p_photo_path where id = p_product_id;
end;
$fn$;

-- ============================================================
-- 3. Grupos de complementos e opções (JM-003, JM-050)
-- ============================================================

create function admin_upsert_option_group(
  p_store_id uuid,
  p_id uuid,
  p_name text,
  p_min_select int,
  p_max_select int
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_id uuid;
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  if p_id is null then
    insert into public.option_groups (store_id, name, min_select, max_select)
    values (p_store_id, trim(p_name), p_min_select, p_max_select)
    returning id into v_id;
  else
    update public.option_groups
       set name = trim(p_name), min_select = p_min_select, max_select = p_max_select
     where id = p_id and store_id = p_store_id
    returning id into v_id;
    if v_id is null then
      raise exception 'grupo nao encontrado nesta loja' using errcode = 'JM404';
    end if;
  end if;

  return v_id;
exception
  when check_violation then
    raise exception 'grupo com minimo e maximo invalidos' using errcode = 'JM422';
end;
$fn$;

create function admin_upsert_option(
  p_group_id uuid,
  p_id uuid,
  p_name text,
  p_price_delta numeric,
  p_pdv_code text,
  p_is_available boolean,
  p_sort_order int
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_store uuid;
  v_id uuid;
begin
  select g.store_id into v_store from public.option_groups g where g.id = p_group_id;
  if v_store is null then
    raise exception 'grupo nao encontrado' using errcode = 'JM404';
  end if;
  perform jm_require_role(v_store, array['owner', 'manager']);

  if p_id is null then
    insert into public.options (group_id, name, price_delta, pdv_code, is_available, sort_order)
    values (p_group_id, trim(p_name), round(coalesce(p_price_delta, 0), 2),
            nullif(trim(p_pdv_code), ''), coalesce(p_is_available, true), coalesce(p_sort_order, 0))
    returning id into v_id;
  else
    update public.options
       set name = trim(p_name),
           price_delta = round(coalesce(p_price_delta, 0), 2),
           pdv_code = nullif(trim(p_pdv_code), ''),
           is_available = coalesce(p_is_available, is_available),
           sort_order = coalesce(p_sort_order, sort_order)
     where id = p_id and group_id = p_group_id
    returning id into v_id;
    if v_id is null then
      raise exception 'opcao nao encontrada neste grupo' using errcode = 'JM404';
    end if;
  end if;

  return v_id;
exception
  when check_violation then
    raise exception 'opcao com campo invalido' using errcode = 'JM422';
end;
$fn$;

-- Substitui os grupos ligados ao produto, na ordem recebida.
create function admin_set_product_groups(p_product_id uuid, p_group_ids uuid[])
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_store uuid;
begin
  select p.store_id into v_store from public.products p where p.id = p_product_id;
  if v_store is null then
    raise exception 'produto nao encontrado' using errcode = 'JM404';
  end if;
  perform jm_require_role(v_store, array['owner', 'manager']);

  if exists (
    select 1 from unnest(coalesce(p_group_ids, '{}')) gid
     where not exists (select 1 from public.option_groups g where g.id = gid and g.store_id = v_store)
  ) then
    raise exception 'grupo de outra loja ou inexistente' using errcode = 'JM422';
  end if;

  delete from public.product_option_groups where product_id = p_product_id;

  insert into public.product_option_groups (product_id, group_id, sort_order)
  select p_product_id, gid, ord::int
    from unnest(coalesce(p_group_ids, '{}')) with ordinality as t(gid, ord);
end;
$fn$;

-- ============================================================
-- 4. Mesas (JM-051). Sem QR de plaquinha nesta fase.
-- ============================================================

create function admin_upsert_table(
  p_store_id uuid,
  p_id uuid,
  p_number int,
  p_label text,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_id uuid;
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  if p_id is null then
    insert into public.tables (store_id, number, label, is_active)
    values (p_store_id, p_number, nullif(trim(p_label), ''), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.tables
       set number = p_number,
           label = nullif(trim(p_label), ''),
           is_active = coalesce(p_is_active, is_active)
     where id = p_id and store_id = p_store_id
    returning id into v_id;
    if v_id is null then
      raise exception 'mesa nao encontrada nesta loja' using errcode = 'JM404';
    end if;
  end if;

  return v_id;
exception
  when unique_violation then
    raise exception 'ja existe mesa com esse numero' using errcode = 'JM409';
  when check_violation then
    raise exception 'numero de mesa invalido' using errcode = 'JM422';
end;
$fn$;

-- ============================================================
-- 5. Dispositivos (JM-180, NF-006)
-- ============================================================

-- Provisiona o tablet de uma mesa (JM-180). O dispositivo nasce SEM token: nasce com um
-- código de uso único, válido por 10 minutos, que o QR de configuração carrega. O token
-- permanente é gerado no pareamento e só aparece na resposta dele (decisão de 14/09/2026).
-- Reprovisionar aposenta o dispositivo ativo anterior da mesa, e o índice único garante
-- um ativo por mesa mesmo em corrida.
create function admin_provision_device(
  p_store_id uuid,
  p_table_id uuid,
  p_name text,
  p_pairing_code_hash text
)
returns table (
  id uuid,
  name text,
  table_id uuid,
  status text,
  provisioned_at timestamptz,
  pairing_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_autor uuid;
  v_id uuid;
begin
  v_autor := jm_require_role(p_store_id, array['owner', 'manager']);

  if p_pairing_code_hash is null or p_pairing_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hash de codigo invalido' using errcode = 'JM422';
  end if;
  if not exists (select 1 from public.tables t where t.id = p_table_id and t.store_id = p_store_id) then
    raise exception 'mesa nao pertence a esta loja' using errcode = 'JM422';
  end if;

  update public.devices d
     set status = 'retired', retired_at = now(), retired_by = v_autor
   where d.table_id = p_table_id and d.status = 'active';

  insert into public.devices (store_id, table_id, name, pairing_code_hash, pairing_expires_at, provisioned_by)
  values (p_store_id, p_table_id, trim(p_name), p_pairing_code_hash, now() + interval '10 minutes', v_autor)
  returning devices.id into v_id;

  return query
    select d.id, d.name, d.table_id, d.status, d.provisioned_at, d.pairing_expires_at
      from public.devices d
     where d.id = v_id;
exception
  when unique_violation then
    raise exception 'outro dispositivo ficou ativo nesta mesa ao mesmo tempo' using errcode = 'JM409';
  when check_violation then
    raise exception 'nome de dispositivo invalido' using errcode = 'JM422';
end;
$fn$;

-- Novo código para o tablet que não pareou a tempo. Só vale para dispositivo ativo e ainda
-- sem token: trocar o tablet de uma mesa já pareada é provisionar outro.
create function admin_renew_pairing_code(p_device_id uuid, p_pairing_code_hash text)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_store uuid;
  v_status text;
  v_token text;
  v_expira timestamptz;
begin
  select d.store_id, d.status, d.token_hash into v_store, v_status, v_token
    from public.devices d where d.id = p_device_id;
  if v_store is null then
    raise exception 'dispositivo nao encontrado' using errcode = 'JM404';
  end if;
  perform jm_require_role(v_store, array['owner', 'manager']);

  if p_pairing_code_hash is null or p_pairing_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hash de codigo invalido' using errcode = 'JM422';
  end if;
  if v_status <> 'active' then
    raise exception 'so dispositivo ativo recebe codigo de pareamento' using errcode = 'JM423';
  end if;
  if v_token is not null then
    raise exception 'dispositivo ja pareado; para trocar o tablet, provisione outro' using errcode = 'JM409';
  end if;

  v_expira := now() + interval '10 minutes';
  update public.devices
     set pairing_code_hash = p_pairing_code_hash, pairing_expires_at = v_expira
   where id = p_device_id;
  return v_expira;
exception
  when unique_violation then
    raise exception 'codigo repetido; gere outro' using errcode = 'JM409';
end;
$fn$;

-- Ativa, desativa ou aposenta. Aposentado não volta: é assim que o token antigo morre.
create function admin_set_device_status(p_device_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_store uuid;
  v_atual text;
  v_autor uuid;
begin
  select d.store_id, d.status into v_store, v_atual from public.devices d where d.id = p_device_id;
  if v_store is null then
    raise exception 'dispositivo nao encontrado' using errcode = 'JM404';
  end if;
  v_autor := jm_require_role(v_store, array['owner', 'manager']);

  if p_status not in ('active', 'inactive', 'retired') then
    raise exception 'estado de dispositivo invalido' using errcode = 'JM422';
  end if;
  if v_atual = 'retired' then
    raise exception 'dispositivo aposentado nao volta; provisione outro' using errcode = 'JM410';
  end if;

  update public.devices
     set status = p_status,
         retired_at = case when p_status = 'retired' then now() else null end,
         retired_by = case when p_status = 'retired' then v_autor else null end
   where id = p_device_id;
exception
  when unique_violation then
    raise exception 'ja existe dispositivo ativo nesta mesa' using errcode = 'JM409';
end;
$fn$;

-- ============================================================
-- 6. Usuários da loja (JM-052)
-- ============================================================

-- Vincula um usuário do Auth à loja com um papel. O convite no Auth é feito pela rota
-- do servidor (única operação nomeada com service_role); o vínculo, não: é gravado aqui,
-- sob o login do dono.
create function admin_add_store_user(p_store_id uuid, p_user_id uuid, p_role text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_id uuid;
begin
  perform jm_require_role(p_store_id, array['owner']);

  if p_role not in ('owner', 'manager', 'waiter', 'kitchen') then
    raise exception 'papel invalido' using errcode = 'JM422';
  end if;

  insert into public.store_users (store_id, user_id, role)
  values (p_store_id, p_user_id, p_role)
  on conflict (store_id, user_id)
    do update set role = excluded.role, is_active = true, deactivated_at = null
  returning store_users.id into v_id;

  return v_id;
exception
  when foreign_key_violation then
    raise exception 'usuario nao existe no Auth' using errcode = 'JM404';
end;
$fn$;

create function admin_set_store_user_role(p_store_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_store uuid;
  v_role_atual text;
begin
  select su.store_id, su.role into v_store, v_role_atual from public.store_users su where su.id = p_store_user_id;
  if v_store is null then
    raise exception 'usuario da loja nao encontrado' using errcode = 'JM404';
  end if;
  perform jm_require_role(v_store, array['owner']);

  if p_role not in ('owner', 'manager', 'waiter', 'kitchen') then
    raise exception 'papel invalido' using errcode = 'JM422';
  end if;

  -- A loja nunca fica sem dono ativo.
  if v_role_atual = 'owner' and p_role <> 'owner'
     and (select count(*) from public.store_users
           where store_id = v_store and role = 'owner' and is_active) <= 1 then
    raise exception 'a loja precisa de pelo menos um dono ativo' using errcode = 'JM409';
  end if;

  update public.store_users set role = p_role where id = p_store_user_id;
end;
$fn$;

-- Desativado perde a escrita na hora: jm_require_role exige is_active (JM-052).
create function admin_deactivate_store_user(p_store_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_store uuid;
  v_role text;
begin
  select su.store_id, su.role into v_store, v_role from public.store_users su where su.id = p_store_user_id;
  if v_store is null then
    raise exception 'usuario da loja nao encontrado' using errcode = 'JM404';
  end if;
  perform jm_require_role(v_store, array['owner']);

  if v_role = 'owner'
     and (select count(*) from public.store_users
           where store_id = v_store and role = 'owner' and is_active) <= 1 then
    raise exception 'a loja precisa de pelo menos um dono ativo' using errcode = 'JM409';
  end if;

  update public.store_users
     set is_active = false, deactivated_at = now()
   where id = p_store_user_id;
end;
$fn$;

-- Usuários da loja com e-mail, para a tela de usuários (JM-052). O e-mail mora em
-- auth.users, que a chave anon não lê: esta function lê, e só para dono e gestor. Nenhuma
-- service_role envolvida.
create function admin_list_store_users(p_store_id uuid)
returns table (id uuid, user_id uuid, email text, role text, is_active boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  return query
    select su.id, su.user_id, u.email::text, su.role, su.is_active, su.created_at
      from public.store_users su
      join auth.users u on u.id = su.user_id
     where su.store_id = p_store_id
     order by su.is_active desc, su.role, u.email;
end;
$fn$;

-- ============================================================
-- 7. Quem executa o quê
-- ============================================================

revoke execute on function jm_windows_valid(jsonb) from public, anon, authenticated;

revoke execute on function admin_upsert_category(uuid, uuid, text, int, boolean) from public, anon, authenticated;
revoke execute on function admin_upsert_product(uuid, uuid, uuid, text, text, numeric, text, boolean, jsonb, text, int, boolean) from public, anon, authenticated;
revoke execute on function admin_set_product_photo(uuid, text) from public, anon, authenticated;
revoke execute on function admin_upsert_option_group(uuid, uuid, text, int, int) from public, anon, authenticated;
revoke execute on function admin_upsert_option(uuid, uuid, text, numeric, text, boolean, int) from public, anon, authenticated;
revoke execute on function admin_set_product_groups(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function admin_upsert_table(uuid, uuid, int, text, boolean) from public, anon, authenticated;
revoke execute on function admin_provision_device(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function admin_set_device_status(uuid, text) from public, anon, authenticated;
revoke execute on function admin_renew_pairing_code(uuid, text) from public, anon, authenticated;
revoke execute on function admin_add_store_user(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function admin_set_store_user_role(uuid, text) from public, anon, authenticated;
revoke execute on function admin_deactivate_store_user(uuid) from public, anon, authenticated;
revoke execute on function admin_list_store_users(uuid) from public, anon, authenticated;

grant execute on function admin_upsert_category(uuid, uuid, text, int, boolean) to authenticated;
grant execute on function admin_upsert_product(uuid, uuid, uuid, text, text, numeric, text, boolean, jsonb, text, int, boolean) to authenticated;
grant execute on function admin_set_product_photo(uuid, text) to authenticated;
grant execute on function admin_upsert_option_group(uuid, uuid, text, int, int) to authenticated;
grant execute on function admin_upsert_option(uuid, uuid, text, numeric, text, boolean, int) to authenticated;
grant execute on function admin_set_product_groups(uuid, uuid[]) to authenticated;
grant execute on function admin_upsert_table(uuid, uuid, int, text, boolean) to authenticated;
grant execute on function admin_provision_device(uuid, uuid, text, text) to authenticated;
grant execute on function admin_set_device_status(uuid, text) to authenticated;
grant execute on function admin_renew_pairing_code(uuid, text) to authenticated;
grant execute on function admin_add_store_user(uuid, uuid, text) to authenticated;
grant execute on function admin_set_store_user_role(uuid, text) to authenticated;
grant execute on function admin_deactivate_store_user(uuid) to authenticated;
grant execute on function admin_list_store_users(uuid) to authenticated;

commit;
