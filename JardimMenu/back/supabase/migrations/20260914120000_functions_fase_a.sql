-- Jardim Menu, functions da Fase A.
-- Toda escrita passa por aqui (regra 2): nenhuma tabela tem policy de escrita.
-- Convenções: security definer, search_path fixo, erro de regra com SQLSTATE da classe JM
-- (JM401 token, JM403 papel, JM404 inexistente, JM409 conflito, JM410 aposentado,
-- JM422 entrada inválida, JM423 inativo). O catálogo de códigos fica em back/.
--
-- Decisão de implementação, registrada: o token do tablet chega às functions já em
-- sha256, calculado na rota do servidor. Assim o token em claro nunca passa pelo
-- Postgres e não pode aparecer em log de statement (NF-006). A recusa continua
-- acontecendo no banco (JM-100): a function procura o hash e recusa.

begin;

-- ============================================================
-- 1. Apoio
-- ============================================================

-- Exige um dos papéis naquela loja, e devolve o store_users.id do autor.
create function jm_require_role(p_store_id uuid, p_roles text[])
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_id uuid;
  v_role text;
begin
  select su.id, su.role
    into v_id, v_role
    from public.store_users su
   where su.store_id = p_store_id
     and su.user_id = auth.uid()
     and su.is_active;

  if v_id is null or not (v_role = any (p_roles)) then
    raise exception 'papel sem permissao para esta acao' using errcode = 'JM403';
  end if;

  return v_id;
end;
$fn$;

-- Resolve o dispositivo pelo hash do token. Uso interno: ninguém executa direto.
create function jm_device_by_hash(p_token_hash text)
returns public.devices
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token de dispositivo invalido' using errcode = 'JM401';
  end if;

  select * into v from public.devices d where d.token_hash = p_token_hash;

  if not found then
    raise exception 'token de dispositivo invalido' using errcode = 'JM401';
  end if;
  if v.status = 'retired' then
    raise exception 'dispositivo aposentado' using errcode = 'JM410';
  end if;
  if v.status <> 'active' then
    raise exception 'dispositivo inativo' using errcode = 'JM423';
  end if;

  return v;
end;
$fn$;

-- Contraste WCAG entre duas cores #rrggbb (JM-055). No banco, e não só na tela, porque
-- o admin escreve por RPC com o próprio login: validação só no front seria contornável.
create function jm_channel(p int)
returns numeric
language sql
immutable
as $fn$
  select case
           when (p / 255.0) <= 0.03928 then (p / 255.0) / 12.92
           else power(((p / 255.0) + 0.055) / 1.055, 2.4)
         end
$fn$;

create function jm_luminance(p_hex text)
returns numeric
language sql
immutable
as $fn$
  select 0.2126 * jm_channel(('x' || substr(p_hex, 2, 2))::bit(8)::int)
       + 0.7152 * jm_channel(('x' || substr(p_hex, 4, 2))::bit(8)::int)
       + 0.0722 * jm_channel(('x' || substr(p_hex, 6, 2))::bit(8)::int)
$fn$;

create function jm_contrast(p_a text, p_b text)
returns numeric
language sql
immutable
as $fn$
  select (greatest(jm_luminance(p_a), jm_luminance(p_b)) + 0.05)
       / (least(jm_luminance(p_a), jm_luminance(p_b)) + 0.05)
$fn$;

-- ============================================================
-- 2. Loja: aparência e horário (JM-005, JM-009, JM-055)
-- ============================================================

create function admin_update_store_appearance(
  p_store_id uuid,
  p_primary text,
  p_accent text,
  p_logo_url text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  if p_primary !~* '^#[0-9a-f]{6}$' or p_accent !~* '^#[0-9a-f]{6}$' then
    raise exception 'cor em formato invalido' using errcode = 'JM422';
  end if;

  -- Texto branco sobre a primária, e destaque sobre o fundo da tela: 4,5:1 nos dois.
  if jm_contrast(lower(p_primary), '#ffffff') < 4.5 then
    raise exception 'cor primaria sem contraste AA com o texto branco' using errcode = 'JM422';
  end if;
  if jm_contrast(lower(p_accent), '#f6f6f3') < 4.5 then
    raise exception 'cor de destaque sem contraste AA com o fundo' using errcode = 'JM422';
  end if;

  update public.stores
     set primary_color = lower(p_primary),
         accent_color = lower(p_accent),
         logo_url = nullif(trim(p_logo_url), '')
   where id = p_store_id;
end;
$fn$;

create function admin_update_store_hours(
  p_store_id uuid,
  p_opening_hours jsonb,
  p_timezone text,
  p_business_day_start time
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'fuso horario invalido' using errcode = 'JM422';
  end if;

  if p_opening_hours is not null then
    if jsonb_typeof(p_opening_hours) <> 'array' then
      raise exception 'horario deve ser uma lista' using errcode = 'JM422';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(p_opening_hours) e
       where jsonb_typeof(e) <> 'object'
          or not (e ? 'dow' and e ? 'open' and e ? 'close')
          or (e ->> 'dow') !~ '^[0-6]$'
          or (e ->> 'open') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or (e ->> 'close') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or (e ->> 'open') = (e ->> 'close')
    ) then
      raise exception 'horario em formato invalido' using errcode = 'JM422';
    end if;

    if (select count(*) <> count(distinct e ->> 'dow')
          from jsonb_array_elements(p_opening_hours) e) then
      raise exception 'dia da semana repetido no horario' using errcode = 'JM422';
    end if;
  end if;

  update public.stores
     set opening_hours = p_opening_hours,
         timezone = p_timezone,
         business_day_start = coalesce(p_business_day_start, business_day_start)
   where id = p_store_id;
end;
$fn$;

-- Estado de horário no fuso da loja (D12, regra 5). Considera o expediente de ontem que
-- cruzou a meia-noite: sexta das 18:00 às 02:00 deixa a loja aberta no sábado à 01:00.
-- opens_day_offset diz em quantos dias abre (0 hoje, 1 amanhã), para a tela não dizer
-- "abre às 18:00" numa segunda quando a próxima abertura é na quarta.
create function store_hours_state(p_store_id uuid, p_now timestamptz default now())
returns table (
  is_open boolean,
  opens_at_local text,
  opens_day_offset int,
  closes_at_local text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_tz text;
  v_hours jsonb;
  v_local timestamp;
  v_dow int;
  v_min int;
  w jsonb;
  v_open int;
  v_close int;
  v_next text;
  v_offset int;
begin
  select s.timezone, s.opening_hours into v_tz, v_hours from public.stores s where s.id = p_store_id;
  if v_tz is null then
    raise exception 'loja % nao encontrada', p_store_id using errcode = 'JM404';
  end if;

  if v_hours is null then
    return query select true, null::text, null::int, null::text;
    return;
  end if;

  v_local := p_now at time zone v_tz;
  v_dow := extract(dow from v_local)::int;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

  for w in select * from jsonb_array_elements(v_hours) loop
    v_open := split_part(w ->> 'open', ':', 1)::int * 60 + split_part(w ->> 'open', ':', 2)::int;
    v_close := split_part(w ->> 'close', ':', 1)::int * 60 + split_part(w ->> 'close', ':', 2)::int;

    if (w ->> 'dow')::int = v_dow
       and ((v_close > v_open and v_min >= v_open and v_min < v_close)
            or (v_close < v_open and v_min >= v_open)) then
      return query select true, null::text, null::int, w ->> 'close';
      return;
    end if;

    if (w ->> 'dow')::int = (v_dow + 6) % 7 and v_close < v_open and v_min < v_close then
      return query select true, null::text, null::int, w ->> 'close';
      return;
    end if;
  end loop;

  -- Fechada: a próxima abertura, hoje mais tarde ou nos próximos dias.
  select s.abre, s.dias
    into v_next, v_offset
    from (
      select e ->> 'open' as abre,
             ((e ->> 'dow')::int - v_dow + 7) % 7 as dias,
             split_part(e ->> 'open', ':', 1)::int * 60 + split_part(e ->> 'open', ':', 2)::int as minuto
        from jsonb_array_elements(v_hours) e
    ) s
   where not (s.dias = 0 and s.minuto <= v_min)
   order by case when s.dias = 0 then 0 else s.dias end, s.minuto
   limit 1;

  if v_next is null then
    -- Só há expediente hoje, e ele já passou: a próxima é daqui a 7 dias.
    select e ->> 'open', 7 into v_next, v_offset
      from jsonb_array_elements(v_hours) e
     order by e ->> 'open'
     limit 1;
  end if;

  return query select false, v_next, v_offset, null::text;
end;
$fn$;

-- ============================================================
-- 3. Disponibilidade de produto em 1 toque (JM-004)
-- ============================================================

create function staff_set_product_availability(p_product_id uuid, p_available boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_store uuid;
  v_autor uuid;
begin
  select p.store_id into v_store from public.products p where p.id = p_product_id;
  if v_store is null then
    raise exception 'produto nao encontrado' using errcode = 'JM404';
  end if;

  v_autor := jm_require_role(v_store, array['owner', 'manager', 'waiter']);

  update public.products
     set is_available = p_available,
         unavailable_since = case when p_available then null else now() end,
         unavailable_by = case when p_available then null else v_autor end
   where id = p_product_id;
end;
$fn$;

-- ============================================================
-- 4. Quem executa o quê. Function nasce executável por PUBLIC no Postgres, então tudo
--    é revogado e concedido nominalmente.
-- ============================================================

revoke execute on function jm_require_role(uuid, text[]) from public, anon, authenticated;
revoke execute on function jm_device_by_hash(text) from public, anon, authenticated;
revoke execute on function jm_channel(int) from public, anon, authenticated;
revoke execute on function jm_luminance(text) from public, anon, authenticated;
revoke execute on function jm_contrast(text, text) from public, anon, authenticated;

revoke execute on function admin_update_store_appearance(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function admin_update_store_hours(uuid, jsonb, text, time) from public, anon, authenticated;
revoke execute on function store_hours_state(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function staff_set_product_availability(uuid, boolean) from public, anon, authenticated;

grant execute on function admin_update_store_appearance(uuid, text, text, text) to authenticated;
grant execute on function admin_update_store_hours(uuid, jsonb, text, time) to authenticated;
grant execute on function store_hours_state(uuid, timestamptz) to authenticated;
grant execute on function staff_set_product_availability(uuid, boolean) to authenticated;

commit;
