-- Jardim Menu, functions da equipe na Fase B (prompt 3): retrato do salão para a tela da
-- equipe (JM-121), chamado, cancelamento em duas portas (JM-033, JM-111), encerrar,
-- renomear e migrar comanda (JM-208, JM-209), fechar mesa (JM-141) e contingência
-- (JM-186). Toda escrita confere o papel na loja antes (jm_require_role), com o autor
-- gravado. Os códigos de erro estão em back/errors.ts.

begin;

-- ============================================================
-- 1. Apoio
-- ============================================================

-- A abertura fecha sozinha quando não resta comanda aberta nela (D26, JM-208, JM-209).
create function jm_close_session_if_empty(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  update public.table_sessions ts
     set status = 'closed', closed_at = now(), close_kind = 'all_tabs_done'
   where ts.id = p_session_id
     and ts.status = 'open'
     and not exists (
       select 1 from public.table_tabs t where t.table_session_id = p_session_id and t.status = 'open'
     );
  return found;
end;
$fn$;

-- Cancela o pedido inteiro (JM-033), com autor, horário e motivo, e grava a transição
-- (JM-034). Pedidos de cancelamento pendentes do mesmo pedido saem aprovados.
create function jm_cancel_order(p_order_id uuid, p_autor uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_status text;
begin
  select o.status into v_status from public.orders o where o.id = p_order_id for update;
  if v_status is null then
    raise exception 'pedido nao encontrado' using errcode = 'JM404';
  end if;
  if v_status = 'cancelled' then
    return;
  end if;

  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_autor, cancel_reason = p_reason
   where id = p_order_id;

  insert into public.order_status_events (order_id, from_status, to_status, actor_user_id)
  values (p_order_id, v_status, 'cancelled', p_autor);

  update public.order_cancel_requests
     set status = 'approved', decided_by = p_autor, decided_at = now(),
         decision_note = coalesce(decision_note, 'pedido cancelado pela equipe')
   where order_id = p_order_id and status = 'pending';
end;
$fn$;

-- Remove um item (remoção lógica, JM-033) e recalcula o subtotal do pedido. Sem item
-- restante, o pedido inteiro é cancelado com o mesmo motivo.
create function jm_remove_item(p_item_id uuid, p_autor uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_pedido uuid;
  v_removido timestamptz;
  v_restante numeric;
  v_itens int;
begin
  select i.order_id, i.removed_at into v_pedido, v_removido
    from public.order_items i where i.id = p_item_id for update;
  if v_pedido is null then
    raise exception 'item nao encontrado' using errcode = 'JM404';
  end if;
  if v_removido is not null then
    return;
  end if;

  update public.order_items
     set removed_at = now(), removed_by = p_autor, remove_reason = p_reason
   where id = p_item_id;

  update public.order_cancel_requests
     set status = 'approved', decided_by = p_autor, decided_at = now(),
         decision_note = coalesce(decision_note, 'item removido pela equipe')
   where order_item_id = p_item_id and status = 'pending';

  select coalesce(sum(i.line_total), 0), count(*) into v_restante, v_itens
    from public.order_items i where i.order_id = v_pedido and i.removed_at is null;

  update public.orders set subtotal = v_restante where id = v_pedido;

  if v_itens = 0 then
    perform jm_cancel_order(v_pedido, p_autor, p_reason);
  end if;
end;
$fn$;

-- Motivo obrigatório, de 1 a 140 caracteres.
create function jm_reason(p_reason text)
returns text
language plpgsql
immutable
as $fn$
begin
  if p_reason is null or length(trim(p_reason)) not between 1 and 140 then
    raise exception 'motivo obrigatorio, de 1 a 140 caracteres' using errcode = 'JM422';
  end if;
  return trim(p_reason);
end;
$fn$;

-- ============================================================
-- 2. Retrato do salão (JM-121, JM-122, JM-184)
-- ============================================================

-- Tudo o que a tela da equipe mostra, num retrato só: mesas com o tablet, a abertura, as
-- comandas abertas, os pedidos (número, itens, complementos, observação, horário e código
-- do PDV), os chamados abertos e os pedidos de cancelamento pendentes. O Realtime só avisa
-- que algo mudou; a tela relê este retrato.
create function staff_floor(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_papel text;
  v_retrato jsonb;
begin
  perform jm_require_role(p_store_id, array['owner', 'manager', 'waiter']);
  v_papel := jm_role(p_store_id);

  select jsonb_build_object(
    'store', jsonb_build_object(
      'id', s.id, 'name', s.name, 'slug', s.slug, 'tab_mode', s.tab_mode,
      'idle_table_alert_minutes', s.idle_table_alert_minutes
    ),
    'role', v_papel,
    'now', now(),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'number', t.number,
               'label', t.label,
               'is_active', t.is_active,
               'ordering_enabled', t.ordering_enabled,
               'ordering_disabled_reason', t.ordering_disabled_reason,
               'device', (
                 select jsonb_build_object(
                          'id', d.id, 'name', d.name, 'status', d.status, 'last_seen_at', d.last_seen_at,
                          'battery_level', d.battery_level, 'app_version', d.app_version
                        )
                   from public.devices d
                  where d.table_id = t.id and d.status <> 'retired'
                  order by (d.status = 'active') desc, d.provisioned_at desc
                  limit 1
               ),
               'session', (
                 select jsonb_build_object(
                          'id', ts.id,
                          'opened_at', ts.opened_at,
                          'tab_mode', ts.tab_mode,
                          'last_order_at', (
                            select max(o.created_at)
                              from public.orders o
                              join public.table_tabs tt on tt.id = o.tab_id
                             where tt.table_session_id = ts.id
                          ),
                          'tabs', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'id', tt.id,
                                     'name', tt.name,
                                     'opened_at', tt.opened_at,
                                     'subtotal', coalesce((
                                       select sum(o.subtotal) from public.orders o
                                        where o.tab_id = tt.id and o.status <> 'cancelled'
                                     ), 0),
                                     'orders', coalesce((
                                       select jsonb_agg(jsonb_build_object(
                                                'id', o.id,
                                                'display_number', o.display_number,
                                                'status', o.status,
                                                'created_at', o.created_at,
                                                'subtotal', o.subtotal,
                                                'cancel_reason', o.cancel_reason,
                                                'items', coalesce((
                                                  select jsonb_agg(jsonb_build_object(
                                                           'id', i.id,
                                                           'name', i.product_name,
                                                           'quantity', i.quantity,
                                                           'notes', i.notes,
                                                           'line_total', i.line_total,
                                                           'removed_at', i.removed_at,
                                                           'remove_reason', i.remove_reason,
                                                           'pdv_code', p.pdv_code,
                                                           'options', coalesce((
                                                             select jsonb_agg(jsonb_build_object(
                                                                      'name', io.option_name, 'pdv_code', op.pdv_code
                                                                    ) order by io.option_name)
                                                               from public.order_item_options io
                                                               left join public.options op on op.id = io.option_id
                                                              where io.order_item_id = i.id
                                                           ), '[]'::jsonb)
                                                         ) order by i.product_name)
                                                    from public.order_items i
                                                    left join public.products p on p.id = i.product_id
                                                   where i.order_id = o.id
                                                ), '[]'::jsonb)
                                              ) order by o.created_at)
                                         from public.orders o
                                        where o.tab_id = tt.id
                                     ), '[]'::jsonb)
                                   ) order by tt.opened_at, tt.name)
                              from public.table_tabs tt
                             where tt.table_session_id = ts.id and tt.status = 'open'
                          ), '[]'::jsonb)
                        )
                   from public.table_sessions ts
                  where ts.table_id = t.id and ts.status = 'open'
               ),
               'calls', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', w.id, 'created_at', w.created_at,
                          'acknowledged_at', w.acknowledged_at, 'reinforced_at', w.reinforced_at
                        ) order by w.created_at)
                   from public.waiter_calls w
                  where w.table_id = t.id and w.closed_at is null
               ), '[]'::jsonb)
             ) order by t.number)
        from public.tables t
       where t.store_id = s.id
         and (t.is_active or exists (
               select 1 from public.table_sessions ts where ts.table_id = t.id and ts.status = 'open'))
    ), '[]'::jsonb),
    'cancel_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'order_id', r.order_id,
               'item_id', r.order_item_id,
               'requested_at', r.requested_at,
               'display_number', o.display_number,
               'tab_name', tt.name,
               'table_number', mt.number,
               'item_name', i.product_name,
               'item_quantity', i.quantity
             ) order by r.requested_at)
        from public.order_cancel_requests r
        join public.orders o on o.id = r.order_id
        join public.table_tabs tt on tt.id = o.tab_id
        join public.table_sessions ts on ts.id = tt.table_session_id
        join public.tables mt on mt.id = ts.table_id
        left join public.order_items i on i.id = r.order_item_id
       where r.store_id = s.id and r.status = 'pending'
    ), '[]'::jsonb)
  )
    into v_retrato
    from public.stores s
   where s.id = p_store_id;

  return v_retrato;
end;
$fn$;

-- ============================================================
-- 3. Chamado de garçom (JM-039)
-- ============================================================

-- "Atender": o tablet da mesa recebe "garçom a caminho" no próximo polling (até 10 s).
create function staff_ack_waiter_call(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_call public.waiter_calls;
  v_autor uuid;
begin
  select * into v_call from public.waiter_calls w where w.id = p_call_id for update;
  if not found then
    raise exception 'chamado nao encontrado' using errcode = 'JM404';
  end if;
  v_autor := jm_require_role(v_call.store_id, array['owner', 'manager', 'waiter']);
  if v_call.closed_at is not null then
    return;
  end if;

  update public.waiter_calls
     set acknowledged_at = now(), acknowledged_by = v_autor, closed_at = now()
   where id = p_call_id;
end;
$fn$;

-- ============================================================
-- 4. Cancelamento em duas portas (JM-033, JM-111, D28)
-- ============================================================

-- A equipe decide o pedido de cancelamento do cliente. Aprovar cancela o pedido, ou
-- remove o item, na mesma transação. O cliente nunca decide: só usuário da equipe chega
-- aqui, e anon nem executa.
create function staff_decide_cancel_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_req public.order_cancel_requests;
  v_autor uuid;
  v_nota text := nullif(trim(coalesce(p_note, '')), '');
  v_motivo text;
begin
  select * into v_req from public.order_cancel_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'pedido de cancelamento nao encontrado' using errcode = 'JM404';
  end if;
  v_autor := jm_require_role(v_req.store_id, array['owner', 'manager', 'waiter']);
  if v_req.status <> 'pending' then
    raise exception 'pedido de cancelamento ja decidido' using errcode = 'JM409';
  end if;
  if p_approve is null then
    raise exception 'decisao obrigatoria' using errcode = 'JM422';
  end if;
  if v_nota is not null and length(v_nota) > 140 then
    raise exception 'nota passa de 140 caracteres' using errcode = 'JM422';
  end if;

  update public.order_cancel_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_autor, decided_at = now(), decision_note = v_nota
   where id = p_request_id;

  if p_approve then
    v_motivo := 'pedido do cliente' || coalesce(': ' || v_nota, '');
    if v_req.order_item_id is null then
      perform jm_cancel_order(v_req.order_id, v_autor, v_motivo);
    else
      perform jm_remove_item(v_req.order_item_id, v_autor, v_motivo);
    end if;
  end if;
end;
$fn$;

create function staff_cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_pedido public.orders;
  v_autor uuid;
begin
  select * into v_pedido from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'pedido nao encontrado' using errcode = 'JM404';
  end if;
  v_autor := jm_require_role(v_pedido.store_id, array['owner', 'manager', 'waiter']);
  if v_pedido.status = 'cancelled' then
    raise exception 'pedido ja cancelado' using errcode = 'JM409';
  end if;
  perform jm_cancel_order(p_order_id, v_autor, jm_reason(p_reason));
end;
$fn$;

create function staff_remove_item(p_item_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_loja uuid;
  v_removido timestamptz;
  v_status text;
  v_autor uuid;
begin
  select o.store_id, i.removed_at, o.status into v_loja, v_removido, v_status
    from public.order_items i
    join public.orders o on o.id = i.order_id
   where i.id = p_item_id;
  if v_loja is null then
    raise exception 'item nao encontrado' using errcode = 'JM404';
  end if;
  v_autor := jm_require_role(v_loja, array['owner', 'manager', 'waiter']);
  if v_removido is not null or v_status = 'cancelled' then
    raise exception 'item ja removido' using errcode = 'JM409';
  end if;
  perform jm_remove_item(p_item_id, v_autor, jm_reason(p_reason));
end;
$fn$;

-- ============================================================
-- 5. Comandas: encerrar, renomear e migrar (JM-208, JM-209, D27, D29)
-- ============================================================

-- Encerrar depois de receber no PDV (D29), em 1 toque. Sem consumo, sai como 'empty'
-- (JM-207). Pedidos de cancelamento pendentes da comanda saem recusados, e a abertura
-- fecha sozinha quando esta era a última comanda aberta.
create function staff_close_tab(p_tab_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_tab public.table_tabs;
  v_mesa uuid;
  v_autor uuid;
  v_fechou boolean;
begin
  select * into v_tab from public.table_tabs t where t.id = p_tab_id;
  if not found then
    raise exception 'comanda inexistente' using errcode = 'JMT01';
  end if;
  v_autor := jm_require_role(v_tab.store_id, array['owner', 'manager', 'waiter']);

  select ts.table_id into v_mesa from public.table_sessions ts where ts.id = v_tab.table_session_id;
  perform 1 from public.tables t where t.id = v_mesa for update;

  select * into v_tab from public.table_tabs t where t.id = p_tab_id for update;
  if v_tab.status <> 'open' then
    raise exception 'comanda ja encerrada' using errcode = 'JMT02';
  end if;

  update public.table_tabs
     set status = 'closed',
         closed_at = now(),
         closed_by = v_autor,
         close_kind = case
                        when exists (
                          select 1 from public.orders o where o.tab_id = p_tab_id and o.status <> 'cancelled'
                        ) then 'settled_outside'
                        else 'empty'
                      end
   where id = p_tab_id;

  update public.order_cancel_requests r
     set status = 'rejected', decided_by = v_autor, decided_at = now(), decision_note = 'comanda encerrada'
   where r.status = 'pending'
     and r.order_id in (select o.id from public.orders o where o.tab_id = p_tab_id);

  v_fechou := jm_close_session_if_empty(v_tab.table_session_id);
  return jsonb_build_object('session_closed', v_fechou);
end;
$fn$;

create function staff_rename_tab(p_tab_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_tab public.table_tabs;
  v_nome text := trim(coalesce(p_name, ''));
begin
  select * into v_tab from public.table_tabs t where t.id = p_tab_id;
  if not found then
    raise exception 'comanda inexistente' using errcode = 'JMT01';
  end if;
  perform jm_require_role(v_tab.store_id, array['owner', 'manager', 'waiter']);
  if v_tab.status <> 'open' then
    raise exception 'comanda ja encerrada' using errcode = 'JMT02';
  end if;
  if length(v_nome) not between 1 and 24 then
    raise exception 'nome de comanda deve ter de 1 a 24 caracteres' using errcode = 'JM422';
  end if;

  update public.table_tabs set name = v_nome where id = p_tab_id;
exception
  when unique_violation then
    raise exception 'ja existe comanda aberta com o nome %', v_nome using errcode = 'JMT04';
end;
$fn$;

-- Migra a comanda para outra mesa, levando só o consumo dela (D27). Mesa de destino livre
-- ganha abertura nova, aberta pela equipe (P3); mesa já aberta recebe a comanda. Os pedidos
-- continuam apontando para a abertura em que foram feitos, e a conta acompanha a comanda.
-- A mesa de origem fecha sozinha se esta era a última comanda aberta.
create function staff_move_tab(p_tab_id uuid, p_to_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_tab public.table_tabs;
  v_origem public.table_sessions;
  v_destino public.tables;
  v_autor uuid;
  v_sessao_destino uuid;
  v_fechou boolean;
begin
  select * into v_tab from public.table_tabs t where t.id = p_tab_id;
  if not found then
    raise exception 'comanda inexistente' using errcode = 'JMT01';
  end if;
  v_autor := jm_require_role(v_tab.store_id, array['owner', 'manager', 'waiter']);

  select * into v_destino from public.tables t where t.id = p_to_table_id;
  if not found then
    raise exception 'mesa de destino inexistente' using errcode = 'JM404';
  end if;
  if v_destino.store_id <> v_tab.store_id then
    raise exception 'mesa de destino de outra loja' using errcode = 'JM403';
  end if;
  if not v_destino.is_active then
    raise exception 'mesa de destino inativa' using errcode = 'JM422';
  end if;

  select * into v_origem from public.table_sessions ts where ts.id = v_tab.table_session_id;
  if v_origem.table_id = p_to_table_id then
    raise exception 'a comanda ja esta nesta mesa' using errcode = 'JM422';
  end if;

  -- As duas mesas, travadas sempre na mesma ordem, para duas migrações cruzadas não se
  -- travarem uma à outra.
  perform 1 from public.tables t where t.id in (v_origem.table_id, p_to_table_id) order by t.id for update;

  select * into v_tab from public.table_tabs t where t.id = p_tab_id for update;
  if v_tab.status <> 'open' then
    raise exception 'comanda encerrada nao migra' using errcode = 'JMT02';
  end if;

  select ts.id into v_sessao_destino
    from public.table_sessions ts
   where ts.table_id = p_to_table_id and ts.status = 'open';
  if v_sessao_destino is null then
    insert into public.table_sessions (store_id, table_id, opened_by_user, tab_mode)
    values (v_tab.store_id, p_to_table_id, v_autor,
            (select s.tab_mode from public.stores s where s.id = v_tab.store_id))
    returning id into v_sessao_destino;
  end if;

  begin
    update public.table_tabs set table_session_id = v_sessao_destino where id = p_tab_id;
  exception
    when unique_violation then
      raise exception 'ja existe comanda aberta com o nome % na mesa de destino', v_tab.name using errcode = 'JMT04';
  end;

  insert into public.tab_moves (store_id, tab_id, from_session_id, to_session_id, moved_by)
  values (v_tab.store_id, p_tab_id, v_origem.id, v_sessao_destino, v_autor);

  v_fechou := jm_close_session_if_empty(v_origem.id);
  return jsonb_build_object('to_session_id', v_sessao_destino, 'origin_closed', v_fechou);
end;
$fn$;

-- ============================================================
-- 6. Mesa: fechar com comanda aberta e contingência (JM-141, JM-186)
-- ============================================================

-- Só dono e gestor, com motivo. Encerra as comandas que sobraram e a abertura, gravando
-- autor, horário e motivo em cada uma, e a mesa fica livre na hora.
create function staff_force_close_session(p_session_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_sessao public.table_sessions;
  v_autor uuid;
  v_motivo text;
begin
  select * into v_sessao from public.table_sessions ts where ts.id = p_session_id;
  if not found then
    raise exception 'abertura de mesa inexistente' using errcode = 'JMS01';
  end if;
  v_autor := jm_require_role(v_sessao.store_id, array['owner', 'manager']);
  v_motivo := jm_reason(p_reason);

  perform 1 from public.tables t where t.id = v_sessao.table_id for update;
  select * into v_sessao from public.table_sessions ts where ts.id = p_session_id for update;
  if v_sessao.status <> 'open' then
    raise exception 'abertura de mesa encerrada' using errcode = 'JMS02';
  end if;

  update public.order_cancel_requests r
     set status = 'rejected', decided_by = v_autor, decided_at = now(), decision_note = 'mesa fechada pelo gerente'
   where r.status = 'pending'
     and r.order_id in (
       select o.id from public.orders o
         join public.table_tabs t on t.id = o.tab_id
        where t.table_session_id = p_session_id and t.status = 'open'
     );

  update public.table_tabs
     set status = 'closed', closed_at = now(), closed_by = v_autor,
         close_kind = 'manager_forced', close_reason = v_motivo
   where table_session_id = p_session_id and status = 'open';

  update public.table_sessions
     set status = 'closed', closed_at = now(), close_kind = 'manager_forced',
         closed_by = v_autor, close_reason = v_motivo
   where id = p_session_id;
end;
$fn$;

-- Contingência por mesa (JM-186): só dono e gestor, com motivo ao desligar. A configuração
-- fica na mesa, e não no tablet, para sobreviver à troca de aparelho. O botão de garçom
-- continua vivo, e o cardápio continua navegável.
create function staff_set_table_ordering(p_table_id uuid, p_enabled boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_loja uuid;
  v_autor uuid;
begin
  select t.store_id into v_loja from public.tables t where t.id = p_table_id;
  if v_loja is null then
    raise exception 'mesa nao encontrada' using errcode = 'JM404';
  end if;
  v_autor := jm_require_role(v_loja, array['owner', 'manager']);
  if p_enabled is null then
    raise exception 'estado obrigatorio' using errcode = 'JM422';
  end if;

  update public.tables
     set ordering_enabled = p_enabled,
         ordering_changed_by = v_autor,
         ordering_changed_at = now(),
         ordering_disabled_reason = case when p_enabled then null else jm_reason(p_reason) end
   where id = p_table_id;
end;
$fn$;

-- Modo de comanda da loja (JM-200): só dono e gestor. Trocar o modo não afeta a abertura
-- que já existe; vale para as próximas.
create function admin_set_tab_mode(p_store_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);
  if p_mode is null or p_mode not in ('mesa_unica', 'nomeada') then
    raise exception 'modo de comanda invalido' using errcode = 'JM422';
  end if;
  update public.stores set tab_mode = p_mode where id = p_store_id;
end;
$fn$;

-- ============================================================
-- 7. Tempo real da tela da equipe (JM-121, NF-003)
-- ============================================================

-- A tela da equipe assina estas tabelas, sob a RLS de leitura dela. `devices` e `tables`
-- ficam fora de propósito: têm colunas secretas (token_hash, qr_token), e o estado do
-- tablet chega pelo retrato do salão.
do $bloco$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.orders, public.order_items, public.waiter_calls, public.order_cancel_requests,
      public.table_tabs, public.table_sessions;
  end if;
end;
$bloco$;

-- ============================================================
-- 8. Quem executa o quê
-- ============================================================

revoke execute on function jm_close_session_if_empty(uuid) from public, anon, authenticated;
revoke execute on function jm_cancel_order(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function jm_remove_item(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function jm_reason(text) from public, anon, authenticated;
revoke execute on function staff_floor(uuid) from public, anon, authenticated;
revoke execute on function staff_ack_waiter_call(uuid) from public, anon, authenticated;
revoke execute on function staff_decide_cancel_request(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function staff_cancel_order(uuid, text) from public, anon, authenticated;
revoke execute on function staff_remove_item(uuid, text) from public, anon, authenticated;
revoke execute on function staff_close_tab(uuid) from public, anon, authenticated;
revoke execute on function staff_rename_tab(uuid, text) from public, anon, authenticated;
revoke execute on function staff_move_tab(uuid, uuid) from public, anon, authenticated;
revoke execute on function staff_force_close_session(uuid, text) from public, anon, authenticated;
revoke execute on function staff_set_table_ordering(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function admin_set_tab_mode(uuid, text) from public, anon, authenticated;

grant execute on function staff_floor(uuid) to authenticated;
grant execute on function staff_ack_waiter_call(uuid) to authenticated;
grant execute on function staff_decide_cancel_request(uuid, boolean, text) to authenticated;
grant execute on function staff_cancel_order(uuid, text) to authenticated;
grant execute on function staff_remove_item(uuid, text) to authenticated;
grant execute on function staff_close_tab(uuid) to authenticated;
grant execute on function staff_rename_tab(uuid, text) to authenticated;
grant execute on function staff_move_tab(uuid, uuid) to authenticated;
grant execute on function staff_force_close_session(uuid, text) to authenticated;
grant execute on function staff_set_table_ordering(uuid, boolean, text) to authenticated;
grant execute on function admin_set_tab_mode(uuid, text) to authenticated;

commit;
