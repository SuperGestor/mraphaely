-- Jardim Menu, functions do tablet na Fase B (prompt 3): abertura de mesa, comandas,
-- pedido, pedido de cancelamento, chamado de garçom, resumo e heartbeat.
--
-- Todas recebem o hash do device_token e recusam no banco (JM-100); a rota só repassa.
-- Cada recusa tem código próprio, catalogado em back/errors.ts:
--   JMS01 abertura inexistente · JMS02 abertura encerrada · JMS03 abertura de outra mesa
--   JMT01 comanda inexistente · JMT02 comanda encerrada · JMT03 comanda de outra abertura
--   JMT04 nome de comanda repetido · JMT05 o modo mesa_unica não cria comanda pelo tablet
--   JMC01 mesa em contingência · JMH01 loja fechada · JMK01 Idempotency-Key inválida
--   JMW01 reforço do chamado antes de 3 minutos
-- Os de antes continuam: JM401, JM403, JM404, JM409, JM410, JM422, JM423, JM451.

begin;

-- ============================================================
-- 1. Apoio
-- ============================================================

-- Preço de um item, no banco (JM-031, JM-003). É a regra que tablet_item_total já usava,
-- agora compartilhada com o pedido: o total que o tablet mostra e o que o pedido grava saem
-- da mesma conta. Produto fora da janela do dia (JM-006) ou em categoria inativa também é
-- recusado aqui, e não só escondido no cardápio.
create function jm_item_price(p_store_id uuid, p_product_id uuid, p_quantity int, p_option_ids uuid[])
returns table (product_name text, unit_price numeric, unit_total numeric, line_total numeric, option_ids uuid[])
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_prod public.products;
  v_tz text;
  v_ids uuid[];
  v_grupo record;
  v_delta numeric;
begin
  select p.* into v_prod
    from public.products p
    join public.categories c on c.id = p.category_id and c.is_active
   where p.id = p_product_id and p.store_id = p_store_id and p.is_active;
  if not found then
    raise exception 'produto nao encontrado' using errcode = 'JM404';
  end if;

  select s.timezone into v_tz from public.stores s where s.id = p_store_id;
  if not v_prod.is_available or not jm_windows_open(v_prod.available_window, v_tz, now()) then
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

  return query select v_prod.name, v_prod.price, v_prod.price + v_delta, (v_prod.price + v_delta) * p_quantity, v_ids;
end;
$fn$;

-- O total do item passa a usar a mesma conta do pedido.
create or replace function tablet_item_total(
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
begin
  v := jm_device_by_hash(p_token_hash);
  return query
    select pr.unit_total, pr.line_total
      from jm_item_price(v.store_id, p_product_id, p_quantity, p_option_ids) pr;
end;
$fn$;

-- Abertura viva da mesa do tablet. Com p_create, abre se não houver (JM-182), com o modo
-- de comanda da loja naquele momento, e, no modo mesa_unica da abertura, garante a comanda
-- "Mesa" (JM-200). Trava a linha da mesa: dois toques ao mesmo tempo não abrem duas
-- aberturas, e dois envios da mesma mesa entram em fila.
create function jm_session_for_device(p_device public.devices, p_create boolean)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_sessao uuid;
  v_modo text;
begin
  if p_device.table_id is null then
    raise exception 'tablet sem mesa' using errcode = 'JM422';
  end if;

  perform 1 from public.tables t where t.id = p_device.table_id for update;

  select ts.id, ts.tab_mode into v_sessao, v_modo
    from public.table_sessions ts
   where ts.table_id = p_device.table_id and ts.status = 'open';

  if not p_create then
    return v_sessao;
  end if;

  if v_sessao is null then
    select s.tab_mode into v_modo from public.stores s where s.id = p_device.store_id;
    insert into public.table_sessions (store_id, table_id, opened_by_device, tab_mode)
    values (p_device.store_id, p_device.table_id, p_device.id, v_modo)
    returning id into v_sessao;
  end if;

  if v_modo = 'mesa_unica'
     and not exists (
       select 1 from public.table_tabs t where t.table_session_id = v_sessao and t.status = 'open'
     ) then
    insert into public.table_tabs (store_id, table_session_id, name, origin, opened_by_device)
    values (p_device.store_id, v_sessao, 'Mesa', 'tablet', p_device.id);
  end if;

  return v_sessao;
end;
$fn$;

-- Abertura e comandas abertas, no formato que o tablet usa.
create function jm_session_payload(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select jsonb_build_object(
           'session_id', ts.id,
           'tab_mode', ts.tab_mode,
           'tabs', coalesce((
             select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.opened_at, t.name)
               from public.table_tabs t
              where t.table_session_id = ts.id and t.status = 'open'
           ), '[]'::jsonb)
         )
    from public.table_sessions ts
   where ts.id = p_session_id
$fn$;

-- ============================================================
-- 2. Abertura de mesa e comandas (JM-182, JM-200, JM-201)
-- ============================================================

-- Primeiro toque no cardápio: abre a abertura da mesa do tablet, ou devolve a que existe.
-- Não há tela de validação (JM-182), e a abertura não expira (D26).
create function tablet_open_session(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
  v_sessao uuid;
begin
  v := jm_device_by_hash(p_token_hash);
  v_sessao := jm_session_for_device(v, true);
  -- Em comando separado de propósito: jm_session_payload é stable e lê com o retrato do
  -- comando que a chamou. Na mesma expressão da abertura, ela não enxergava a abertura que
  -- acabou de nascer, e o primeiro toque recebia resposta vazia.
  return jm_session_payload(v_sessao);
end;
$fn$;

-- Cria comanda com nome (JM-201). Só em abertura do modo nomeada: no mesa_unica o cliente
-- nunca vê a palavra comanda. O modo que vale é o da abertura, e não o atual da loja
-- (JM-200). Nome único só entre as abertas da mesma abertura, sem diferenciar maiúscula
-- de minúscula (P6).
create function tablet_create_tab(p_token_hash text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
  v_modo text;
  v_nome text := trim(coalesce(p_name, ''));
  v_sessao uuid;
  v_tab uuid;
begin
  v := jm_device_by_hash(p_token_hash);

  -- Abre a mesa se preciso (com o modo da loja) e lê o modo da abertura. Se a recusa vier
  -- depois, a transação desfaz a abertura.
  v_sessao := jm_session_for_device(v, true);
  select ts.tab_mode into v_modo from public.table_sessions ts where ts.id = v_sessao;
  if v_modo <> 'nomeada' then
    raise exception 'esta mesa usa a comanda unica' using errcode = 'JMT05';
  end if;
  if length(v_nome) not between 1 and 24 then
    raise exception 'nome de comanda deve ter de 1 a 24 caracteres' using errcode = 'JM422';
  end if;

  begin
    insert into public.table_tabs (store_id, table_session_id, name, origin, opened_by_device)
    values (v.store_id, v_sessao, v_nome, 'tablet', v.id)
    returning id into v_tab;
  exception
    when unique_violation then
      raise exception 'ja existe comanda aberta com o nome %', v_nome using errcode = 'JMT04';
  end;

  return jsonb_build_object('id', v_tab, 'name', v_nome, 'session_id', v_sessao);
end;
$fn$;

-- ============================================================
-- 3. Pedido (JM-031, JM-032, JM-034, JM-036, JM-100, JM-202)
-- ============================================================

-- O pedido nasce confirmed, sem toque da equipe (D2b). O tablet manda só identificadores,
-- quantidade e observação por item; preço, número e turno saem daqui. A mesma chave de
-- idempotência na mesma abertura devolve o mesmo pedido (replayed); em outra abertura, é
-- outro pedido, e nunca o alheio (T5).
create function tablet_place_order(
  p_token_hash text,
  p_session_id uuid,
  p_tab_id uuid,
  p_idempotency_key text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v public.devices;
  v_mesa public.tables;
  v_sessao public.table_sessions;
  v_tab public.table_tabs;
  v_existente public.orders;
  v_aberta boolean;
  v_turno date;
  v_numero int;
  v_pedido uuid;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_produto uuid;
  v_qtd int;
  v_ids uuid[];
  v_notes text;
  v_preco record;
  v_linha uuid;
begin
  v := jm_device_by_hash(p_token_hash);

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Idempotency-Key ausente ou fora do formato' using errcode = 'JMK01';
  end if;

  -- A mesa do tablet, travada: pedidos da mesma mesa entram em fila, e o replay da mesma
  -- chave enxerga o pedido que a primeira tentativa gravou.
  select * into v_mesa from public.tables t where t.id = v.table_id for update;
  if not found then
    raise exception 'tablet sem mesa' using errcode = 'JM422';
  end if;

  select * into v_sessao from public.table_sessions ts where ts.id = p_session_id;
  if not found then
    raise exception 'abertura de mesa inexistente' using errcode = 'JMS01';
  end if;
  if v_sessao.table_id <> v.table_id then
    raise exception 'abertura de outra mesa' using errcode = 'JMS03';
  end if;

  select * into v_existente
    from public.orders o
   where o.table_session_id = p_session_id and o.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'order_id', v_existente.id, 'display_number', v_existente.display_number,
      'subtotal', v_existente.subtotal, 'replayed', true
    );
  end if;

  if v_sessao.status <> 'open' then
    raise exception 'abertura de mesa encerrada' using errcode = 'JMS02';
  end if;

  select * into v_tab from public.table_tabs t where t.id = p_tab_id;
  if not found then
    raise exception 'comanda inexistente' using errcode = 'JMT01';
  end if;
  if v_tab.table_session_id <> v_sessao.id then
    raise exception 'comanda de outra abertura' using errcode = 'JMT03';
  end if;
  if v_tab.status <> 'open' then
    raise exception 'comanda encerrada: abra outra comanda' using errcode = 'JMT02';
  end if;

  if not v_mesa.ordering_enabled then
    raise exception 'mesa em contingencia: peca ao garcom' using errcode = 'JMC01';
  end if;

  select h.is_open into v_aberta from store_hours_state(v.store_id, now()) h;
  if not v_aberta then
    raise exception 'loja fechada agora' using errcode = 'JMH01';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'o pedido precisa de 1 a 50 itens' using errcode = 'JM422';
  end if;

  -- Número amigável por loja e turno (JM-036): o contador sobe com trava de linha, e
  -- orders_display_uq garante a unicidade. Se qualquer item for recusado adiante, tudo é
  -- desfeito, o número inclusive.
  v_turno := shift_date(now(), v.store_id);
  insert into public.order_number_counters (store_id, business_date, last_number)
  values (v.store_id, v_turno, 1)
  on conflict (store_id, business_date)
    do update set last_number = public.order_number_counters.last_number + 1
  returning last_number into v_numero;

  insert into public.orders (store_id, table_session_id, tab_id, device_id, idempotency_key,
                             business_date, display_number, subtotal)
  values (v.store_id, v_sessao.id, v_tab.id, v.id, p_idempotency_key, v_turno, v_numero, 0)
  returning id into v_pedido;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or (v_item ->> 'product_id') is null or (v_item ->> 'product_id') !~* c_uuid
       or jsonb_typeof(v_item -> 'quantity') <> 'number'
       or (v_item ->> 'quantity') !~ '^[0-9]{1,2}$' then
      raise exception 'item do pedido em formato invalido' using errcode = 'JM422';
    end if;
    v_produto := (v_item ->> 'product_id')::uuid;
    v_qtd := (v_item ->> 'quantity')::int;

    if v_item ? 'option_ids' and jsonb_typeof(v_item -> 'option_ids') <> 'null' then
      if jsonb_typeof(v_item -> 'option_ids') <> 'array'
         or exists (
           select 1 from jsonb_array_elements(v_item -> 'option_ids') o
            where jsonb_typeof(o) <> 'string' or (o #>> '{}') !~* c_uuid
         ) then
        raise exception 'complementos em formato invalido' using errcode = 'JM422';
      end if;
      select coalesce(array_agg((o #>> '{}')::uuid), '{}') into v_ids
        from jsonb_array_elements(v_item -> 'option_ids') o;
    else
      v_ids := '{}';
    end if;

    v_notes := null;
    if v_item ? 'notes' and jsonb_typeof(v_item -> 'notes') = 'string' then
      v_notes := nullif(trim(v_item ->> 'notes'), '');
      if length(v_notes) > 140 then
        raise exception 'observacao passa de 140 caracteres' using errcode = 'JM422';
      end if;
    elsif v_item ? 'notes' and jsonb_typeof(v_item -> 'notes') <> 'null' then
      raise exception 'observacao em formato invalido' using errcode = 'JM422';
    end if;

    select * into v_preco from jm_item_price(v.store_id, v_produto, v_qtd, v_ids);

    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, notes, line_total)
    values (v_pedido, v_produto, v_preco.product_name, v_preco.unit_price, v_qtd, v_notes, v_preco.line_total)
    returning id into v_linha;

    insert into public.order_item_options (order_item_id, option_id, option_name, price_delta)
    select v_linha, o.id, o.name, o.price_delta
      from public.options o
     where o.id = any (v_preco.option_ids);

    v_subtotal := v_subtotal + v_preco.line_total;
  end loop;

  update public.orders set subtotal = v_subtotal where id = v_pedido;

  -- Nascimento do pedido (JM-034): nulo -> confirmed, pelo tablet.
  insert into public.order_status_events (order_id, from_status, to_status, actor_device_id)
  values (v_pedido, null, 'confirmed', v.id);

  return jsonb_build_object(
    'order_id', v_pedido, 'display_number', v_numero, 'subtotal', v_subtotal, 'replayed', false
  );
end;
$fn$;

-- ============================================================
-- 4. Pedido de cancelamento pelo cliente (JM-111, D28, P1)
-- ============================================================

-- O cliente pede; a equipe decide. Só pedido da abertura viva desta mesa, em comanda
-- aberta. Dois toques devolvem o mesmo pedido de cancelamento (índice único parcial).
create function tablet_request_cancel(p_token_hash text, p_order_id uuid, p_item_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
  v_pedido public.orders;
  v_tab public.table_tabs;
  v_sessao public.table_sessions;
  v_req uuid;
  v_repetido boolean := false;
begin
  v := jm_device_by_hash(p_token_hash);

  select * into v_pedido from public.orders o where o.id = p_order_id and o.store_id = v.store_id for update;
  if not found then
    raise exception 'pedido nao encontrado' using errcode = 'JM404';
  end if;

  select * into v_tab from public.table_tabs t where t.id = v_pedido.tab_id;
  select * into v_sessao from public.table_sessions ts where ts.id = v_tab.table_session_id;
  if v_sessao.table_id <> v.table_id or v_sessao.status <> 'open' then
    raise exception 'pedido de outra mesa' using errcode = 'JM403';
  end if;
  if v_tab.status <> 'open' then
    raise exception 'comanda encerrada' using errcode = 'JMT02';
  end if;
  if v_pedido.status = 'cancelled' then
    raise exception 'pedido ja cancelado' using errcode = 'JM409';
  end if;

  if p_item_id is not null
     and not exists (
       select 1 from public.order_items i
        where i.id = p_item_id and i.order_id = p_order_id and i.removed_at is null
     ) then
    raise exception 'item nao encontrado neste pedido' using errcode = 'JM404';
  end if;

  select r.id into v_req
    from public.order_cancel_requests r
   where r.order_id = p_order_id
     and r.order_item_id is not distinct from p_item_id
     and r.status = 'pending';

  if v_req is null then
    insert into public.order_cancel_requests (store_id, order_id, order_item_id, requested_by_device)
    values (v.store_id, p_order_id, p_item_id, v.id)
    returning id into v_req;
  else
    v_repetido := true;
  end if;

  return jsonb_build_object('request_id', v_req, 'status', 'pending', 'repeated', v_repetido);
end;
$fn$;

-- ============================================================
-- 5. Chamado de garçom (JM-038, JM-040, JM-187)
-- ============================================================

-- O caminho garantido (JM-187): funciona com a mesa em contingência, a loja fechada, sem
-- abertura e com o tablet desativado. Só o token desconhecido ou aposentado é recusado.
-- Enquanto houver chamado aberto, ou nos 60 s depois do último, o toque devolve o mesmo
-- chamado (JM-038), com trava na linha da mesa.
create function tablet_call_waiter(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
  v_ultima public.waiter_calls;
  v_sessao uuid;
  v_id uuid;
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
  if v.table_id is null then
    raise exception 'tablet sem mesa' using errcode = 'JM422';
  end if;

  perform 1 from public.tables t where t.id = v.table_id for update;

  select * into v_ultima
    from public.waiter_calls w
   where w.table_id = v.table_id
   order by w.created_at desc
   limit 1;

  if found and (v_ultima.closed_at is null or v_ultima.created_at > now() - interval '60 seconds') then
    return jsonb_build_object(
      'call_id', v_ultima.id, 'created_at', v_ultima.created_at,
      'acknowledged_at', v_ultima.acknowledged_at, 'reinforced_at', v_ultima.reinforced_at,
      'closed_at', v_ultima.closed_at, 'repeated', true
    );
  end if;

  select ts.id into v_sessao
    from public.table_sessions ts
   where ts.table_id = v.table_id and ts.status = 'open';

  insert into public.waiter_calls (store_id, table_id, table_session_id, device_id)
  values (v.store_id, v.table_id, v_sessao, v.id)
  returning id into v_id;

  return jsonb_build_object(
    'call_id', v_id, 'created_at', now(), 'acknowledged_at', null,
    'reinforced_at', null, 'closed_at', null, 'repeated', false
  );
end;
$fn$;

-- Reforço (JM-040): só depois de 3 min sem atendimento, uma vez, e sem abrir chamado novo,
-- então não burla o limite de 60 s.
create function tablet_reinforce_call(p_token_hash text, p_call_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
  v_call public.waiter_calls;
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

  select * into v_call from public.waiter_calls w where w.id = p_call_id for update;
  if not found or v_call.table_id is distinct from v.table_id then
    raise exception 'chamado nao encontrado' using errcode = 'JM404';
  end if;
  if v_call.closed_at is not null or v_call.acknowledged_at is not null then
    raise exception 'chamado ja atendido' using errcode = 'JM409';
  end if;
  if v_call.reinforced_at is null then
    if v_call.created_at > now() - interval '3 minutes' then
      raise exception 'reforco so depois de 3 minutos' using errcode = 'JMW01';
    end if;
    update public.waiter_calls set reinforced_at = now() where id = p_call_id
    returning * into v_call;
  end if;

  return jsonb_build_object(
    'call_id', v_call.id, 'created_at', v_call.created_at,
    'acknowledged_at', v_call.acknowledged_at, 'reinforced_at', v_call.reinforced_at,
    'closed_at', v_call.closed_at
  );
end;
$fn$;

-- ============================================================
-- 6. Resumo para o polling de 10 s (JM-011, JM-012, JM-203, D29)
-- ============================================================

-- A abertura viva da mesa, com as comandas abertas e o que foi pedido em cada uma:
-- pedidos cancelados e itens removidos saem da lista e do total. O subtotal de cada
-- comanda e o total da mesa são somados aqui, e não no tablet. Traz também os pedidos de
-- cancelamento (pendentes e decididos nos últimos 10 min) e o chamado de garçom vivo.
create function tablet_session_summary(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
  v_mesa public.tables;
  v_sessao public.table_sessions;
  v_modo text;
  v_abas jsonb;
  v_chamado jsonb;
  v_cancel jsonb;
begin
  v := jm_device_by_hash(p_token_hash);
  select * into v_mesa from public.tables t where t.id = v.table_id;
  select s.tab_mode into v_modo from public.stores s where s.id = v.store_id;

  select * into v_sessao
    from public.table_sessions ts
   where ts.table_id = v.table_id and ts.status = 'open';

  if v_sessao.id is not null then
    -- Com abertura viva, vale o modo dela (JM-200); sem abertura, o da loja, que é o que a
    -- próxima abertura vai copiar.
    v_modo := v_sessao.tab_mode;
    select coalesce(jsonb_agg(aba order by (aba ->> 'opened_at')), '[]'::jsonb) into v_abas
      from (
        select jsonb_build_object(
                 'id', t.id,
                 'name', t.name,
                 'opened_at', t.opened_at,
                 'subtotal', coalesce((
                   select sum(i.line_total)
                     from public.orders o
                     join public.order_items i on i.order_id = o.id and i.removed_at is null
                    where o.tab_id = t.id and o.status <> 'cancelled'
                 ), 0),
                 'orders', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', o.id,
                            'display_number', o.display_number,
                            'status', o.status,
                            'created_at', o.created_at,
                            'subtotal', o.subtotal,
                            'items', coalesce((
                              select jsonb_agg(jsonb_build_object(
                                       'id', i.id,
                                       'name', i.product_name,
                                       'quantity', i.quantity,
                                       'notes', i.notes,
                                       'line_total', i.line_total,
                                       'options', coalesce((
                                         select jsonb_agg(io.option_name order by io.option_name)
                                           from public.order_item_options io
                                          where io.order_item_id = i.id
                                       ), '[]'::jsonb)
                                     ) order by i.product_name)
                                from public.order_items i
                               where i.order_id = o.id and i.removed_at is null
                            ), '[]'::jsonb)
                          ) order by o.created_at)
                     from public.orders o
                    where o.tab_id = t.id and o.status <> 'cancelled'
                 ), '[]'::jsonb)
               ) as aba
          from public.table_tabs t
         where t.table_session_id = v_sessao.id and t.status = 'open'
      ) abas;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'order_id', r.order_id, 'item_id', r.order_item_id,
             'status', r.status, 'requested_at', r.requested_at, 'decided_at', r.decided_at
           ) order by r.requested_at), '[]'::jsonb)
      into v_cancel
      from public.order_cancel_requests r
      join public.orders o on o.id = r.order_id
      join public.table_tabs t on t.id = o.tab_id
     where t.table_session_id = v_sessao.id
       and (r.status = 'pending' or r.decided_at > now() - interval '10 minutes');
  end if;

  select jsonb_build_object(
           'call_id', w.id, 'created_at', w.created_at, 'acknowledged_at', w.acknowledged_at,
           'reinforced_at', w.reinforced_at, 'closed_at', w.closed_at
         )
    into v_chamado
    from public.waiter_calls w
   where w.table_id = v.table_id
     and (w.closed_at is null or w.closed_at > now() - interval '2 minutes')
   order by w.created_at desc
   limit 1;

  return jsonb_build_object(
    'table_number', v_mesa.number,
    'ordering_enabled', v_mesa.ordering_enabled,
    'tab_mode', v_modo,
    'session', case when v_sessao.id is null then null
                    else jsonb_build_object('id', v_sessao.id, 'opened_at', v_sessao.opened_at) end,
    'tabs', coalesce(v_abas, '[]'::jsonb),
    'total', coalesce((select sum((a ->> 'subtotal')::numeric) from jsonb_array_elements(v_abas) a), 0),
    'cancel_requests', coalesce(v_cancel, '[]'::jsonb),
    'waiter_call', v_chamado
  );
end;
$fn$;

-- ============================================================
-- 7. Heartbeat (JM-184)
-- ============================================================

create function device_heartbeat(p_token_hash text, p_app_version text, p_battery int)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v public.devices;
begin
  v := jm_device_by_hash(p_token_hash);
  if p_app_version is not null and length(p_app_version) > 40 then
    raise exception 'versao do app em formato invalido' using errcode = 'JM422';
  end if;
  if p_battery is not null and (p_battery < 0 or p_battery > 100) then
    raise exception 'bateria fora de 0 a 100' using errcode = 'JM422';
  end if;

  update public.devices
     set last_seen_at = now(),
         app_version = coalesce(nullif(trim(p_app_version), ''), app_version),
         battery_level = coalesce(p_battery, battery_level)
   where id = v.id;
end;
$fn$;

-- ============================================================
-- 8. Quem executa o quê
-- ============================================================

revoke execute on function jm_item_price(uuid, uuid, int, uuid[]) from public, anon, authenticated;
revoke execute on function jm_session_for_device(public.devices, boolean) from public, anon, authenticated;
revoke execute on function jm_session_payload(uuid) from public, anon, authenticated;
revoke execute on function tablet_open_session(text) from public, anon, authenticated;
revoke execute on function tablet_create_tab(text, text) from public, anon, authenticated;
revoke execute on function tablet_place_order(text, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function tablet_request_cancel(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function tablet_call_waiter(text) from public, anon, authenticated;
revoke execute on function tablet_reinforce_call(text, uuid) from public, anon, authenticated;
revoke execute on function tablet_session_summary(text) from public, anon, authenticated;
revoke execute on function device_heartbeat(text, text, int) from public, anon, authenticated;

-- O tablet não é usuário autenticado: a rota chama com a chave anon.
grant execute on function tablet_open_session(text) to anon, authenticated;
grant execute on function tablet_create_tab(text, text) to anon, authenticated;
grant execute on function tablet_place_order(text, uuid, uuid, text, jsonb) to anon, authenticated;
grant execute on function tablet_request_cancel(text, uuid, uuid) to anon, authenticated;
grant execute on function tablet_call_waiter(text) to anon, authenticated;
grant execute on function tablet_reinforce_call(text, uuid) to anon, authenticated;
grant execute on function tablet_session_summary(text) to anon, authenticated;
grant execute on function device_heartbeat(text, text, int) to anon, authenticated;

commit;
