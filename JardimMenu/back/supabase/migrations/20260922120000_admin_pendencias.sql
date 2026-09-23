-- Jardim Menu, pendências do admin (22/09/2026): o tempo de mesa parada (JM-122), o painel
-- do pixel (JM-062, P9) e o vínculo de conta que já existe no Auth (JM-052).
--
-- Mesmas convenções das migrações anteriores: security definer, search_path fixo, papel
-- conferido por jm_require_role antes de tudo, erro de regra com SQLSTATE da classe JM
-- (catálogo em back/errors.ts) e execute revogado de public, anon e authenticated antes do
-- grant nominal. Nenhuma conta de "dia" fora do banco: quem resolve turno é shift_date
-- (regra 5 do CLAUDE.md, D12).

begin;

-- ============================================================
-- 1. Mesa parada (JM-122, P5)
-- ============================================================

-- O tempo que a tela da equipe espera antes de destacar a mesa sem pedido. A faixa de 30 a
-- 1440 minutos já é o CHECK de stores (stores_idle_alert_ck); a function recusa antes, com
-- JM422, para a tela dizer o limite em vez de cair em erro interno. O destaque não encerra
-- nada: quem encerra é a equipe (JM-141), e isto não muda aqui.
create function admin_update_store_idle_alert(p_store_id uuid, p_minutes int)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  if p_minutes is null or p_minutes < 30 or p_minutes > 1440 then
    raise exception 'tempo de mesa parada fora do limite: de 30 a 1440 minutos' using errcode = 'JM422';
  end if;

  update public.stores
     set idle_table_alert_minutes = p_minutes
   where id = p_store_id;
end;
$fn$;

-- ============================================================
-- 2. Painel do pixel (JM-062, P9)
-- ============================================================

-- As quatro listas do JM-062, por turno: nunca vistos, pouco vistos, vistos sem conversão
-- e campeões de conversão. Lido só por dono e gestor, como o requisito pede.
--
-- De onde sai cada número:
-- - Impressões, cliques e "na sacola" saem do pixel (menu_events), contados um a um: é a
--   "soma dos eventos do turno" do critério de aceite.
-- - Pedido sai do pedido de verdade (orders e order_items), e NÃO do pixel. O evento
--   order_submitted é gravado sem product_id (o tablet manda um por envio, não um por
--   item), então a view product_engagement dá conversão zero para todo produto. Aqui conta
--   o pedido não cancelado com o item não removido: é o que a casa vendeu (JM-033).
--
-- O turno é sempre o da shift_date (D12, regra 5): o do pedido já está gravado em
-- orders.business_date, que a escrita calcula com ela; o do evento é calculado com ela
-- aqui. Sem data, vale o turno de agora, resolvido no banco. Turno no futuro é recusado.
--
-- Régua de leitura, explícita porque é provisória (pergunta ao dono do produto):
-- - "Pouco visto": teve impressão no turno e ficou em no máximo um quarto da MEDIANA de
--   impressões dos produtos vistos no mesmo turno. Relativo, e não um número fixo, para
--   valer tanto na casa cheia quanto na vazia; um quarto, e não a metade, para só apontar o
--   que está claramente abaixo do resto. Com pouco movimento (mediana abaixo de 4) o limite
--   cai abaixo de 1 e nenhum produto é apontado, que é o conservador: com dez impressões no
--   turno inteiro, nada ali é conclusão.
-- - Conversão: pedidos com o produto divididos pelas impressões dele no turno. A impressão
--   é uma por produto por sessão do pixel (front/lib/pixel.ts), então a taxa aproxima "de
--   cada mesa que viu, quantas pediram". Sem impressão não há taxa (fica nula).
-- - "Campeões": entre os produtos vistos ao menos tanto quanto o produto mediano, os 10 de
--   maior conversão. O piso da mediana existe para um produto visto uma vez e pedido uma
--   vez não encabeçar a lista com 100%; é a mesma régua do "pouco visto", do outro lado.
-- - Entra no painel o produto que está no cardápio (produto e categoria ativos) e também o
--   que saiu dele mas teve movimento no turno; cada linha diz em qual dos dois casos está.
--   Produto sem impressão aparece em "nunca vistos" mesmo tendo pedido (o pixel pode perder
--   evento: sem rede, sem JavaScript, aparelho desligado), e a linha mostra o pedido.
create function admin_menu_panel(p_store_id uuid, p_business_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  c_fracao_pouco_visto constant numeric := 0.25;
  c_limite_campeoes constant int := 10;
  v_hoje date;
  v_dia date;
  v_painel jsonb;
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  v_hoje := shift_date(now(), p_store_id);
  v_dia := coalesce(p_business_date, v_hoje);
  if v_dia > v_hoje then
    raise exception 'turno no futuro: escolha o turno de hoje ou um anterior' using errcode = 'JM422';
  end if;

  with eventos as (
    select e.product_id,
           count(*) filter (where e.event_type = 'product_impression') as impressoes,
           count(*) filter (where e.event_type = 'product_click') as cliques,
           count(*) filter (where e.event_type = 'add_to_cart') as na_sacola
      from public.menu_events e
     where e.store_id = p_store_id
       and e.product_id is not null
       and e.event_type in ('product_impression', 'product_click', 'add_to_cart')
       -- Janela larga, só para o índice menu_events_by_store_received poder entrar: cobre
       -- qualquer fuso e qualquer início de turno. Quem decide o turno é a shift_date, na
       -- linha de baixo.
       and e.received_at >= ((v_dia - 2)::timestamp at time zone 'UTC')
       and e.received_at < ((v_dia + 3)::timestamp at time zone 'UTC')
       and shift_date(e.received_at, p_store_id) = v_dia
     group by e.product_id
  ),
  pedidos as (
    select i.product_id,
           count(distinct o.id) as pedidos,
           sum(i.quantity) as quantidade
      from public.orders o
      join public.order_items i on i.order_id = o.id
     where o.store_id = p_store_id
       and o.business_date = v_dia
       and o.status <> 'cancelled'
       and i.removed_at is null
     group by i.product_id
  ),
  base as (
    select p.id,
           p.name,
           c.name as categoria,
           (p.is_active and c.is_active) as no_cardapio,
           coalesce(ev.impressoes, 0) as impressoes,
           coalesce(ev.cliques, 0) as cliques,
           coalesce(ev.na_sacola, 0) as na_sacola,
           coalesce(pe.pedidos, 0) as pedidos,
           coalesce(pe.quantidade, 0) as quantidade
      from public.products p
      join public.categories c on c.id = p.category_id
      left join eventos ev on ev.product_id = p.id
      left join pedidos pe on pe.product_id = p.id
     where p.store_id = p_store_id
       and ((p.is_active and c.is_active) or ev.product_id is not null or pe.product_id is not null)
  ),
  regua as (
    select percentile_cont(0.5) within group (order by b.impressoes)::numeric as mediana
      from base b
     where b.impressoes > 0
  ),
  linhas as (
    select b.*,
           case when b.impressoes > 0 then round(b.pedidos::numeric / b.impressoes, 4) end as conversao,
           jsonb_build_object(
             'product_id', b.id,
             'name', b.name,
             'category', b.categoria,
             'in_menu', b.no_cardapio,
             'impressions', b.impressoes,
             'clicks', b.cliques,
             'adds_to_cart', b.na_sacola,
             'orders', b.pedidos,
             'quantity', b.quantidade,
             'conversion', case when b.impressoes > 0 then round(b.pedidos::numeric / b.impressoes, 4) end
           ) as j
      from base b
  )
  select jsonb_build_object(
           'business_date', v_dia,
           'current_business_date', v_hoje,
           'previous_business_date', v_dia - 1,
           'next_business_date', case when v_dia < v_hoje then v_dia + 1 end,
           -- A régua vai junto para a tela explicar a lista em vez de mostrar número solto.
           'rules', (
             select jsonb_build_object(
                      'low_view_fraction', c_fracao_pouco_visto,
                      'median_impressions', r.mediana,
                      'low_view_max', r.mediana * c_fracao_pouco_visto,
                      'champion_min_impressions', r.mediana,
                      'champions_limit', c_limite_campeoes
                    )
               from regua r
           ),
           -- Somados das mesmas linhas que as listas mostram, para o topo da tela nunca
           -- divergir do corpo dela.
           'totals', jsonb_build_object(
             'impressions', (select coalesce(sum(l.impressoes), 0) from linhas l),
             'clicks', (select coalesce(sum(l.cliques), 0) from linhas l),
             'adds_to_cart', (select coalesce(sum(l.na_sacola), 0) from linhas l),
             'ordered_products', (select count(*) from linhas l where l.pedidos > 0),
             'orders', (
               select count(*)
                 from public.orders o
                where o.store_id = p_store_id
                  and o.business_date = v_dia
                  and o.status <> 'cancelled'
             ),
             'products', (select count(*) from linhas)
           ),
           'never_seen', coalesce((
             select jsonb_agg(l.j order by l.no_cardapio desc, l.categoria, l.name)
               from linhas l
              where l.impressoes = 0
           ), '[]'::jsonb),
           'low_seen', coalesce((
             select jsonb_agg(l.j order by l.impressoes, l.name)
               from linhas l, regua r
              where l.impressoes > 0
                and l.impressoes <= r.mediana * c_fracao_pouco_visto
           ), '[]'::jsonb),
           'seen_no_conversion', coalesce((
             select jsonb_agg(l.j order by l.impressoes desc, l.name)
               from linhas l
              where l.impressoes > 0
                and l.pedidos = 0
           ), '[]'::jsonb),
           'champions', coalesce((
             select jsonb_agg(x.j order by x.conversao desc, x.pedidos desc, x.name)
               from (
                 select l.j, l.conversao, l.pedidos, l.name
                   from linhas l, regua r
                  where l.pedidos > 0
                    and l.impressoes >= r.mediana
                  order by l.conversao desc, l.pedidos desc, l.name
                  limit c_limite_campeoes
               ) x
           ), '[]'::jsonb)
         )
    into v_painel;

  return v_painel;
end;
$fn$;

-- ============================================================
-- 3. Vínculo de conta que já existe (JM-052)
-- ============================================================

-- Convidar um e-mail que já tem conta no Auth: o convite é recusado, porque a conta existe,
-- e o que falta é só o vínculo com a loja. Esta function acha a conta pelo e-mail e grava o
-- vínculo, sob o login do dono, como admin_add_store_user. Nenhuma chave de servidor entra:
-- quem lê auth.users é a própria function (mesmo caminho de admin_list_store_users), e ela
-- não devolve nada da conta além do id do vínculo criado (NF-006). Saber que o e-mail tem
-- conta não é informação nova para quem chama: o convite já tinha respondido isso.
--
-- Recusas, todas conservadoras:
-- - Nenhuma conta com o e-mail: JM404, e a rota segue para o convite de conta nova.
-- - Mais de uma conta com o mesmo e-mail (só acontece com login federado, que a casa não
--   usa): JM422, sem escolher uma ao acaso.
-- - A conta já está na loja, ativa ou desativada: JM409. Trocar papel e reativar são da
--   lista de usuários, que protege o último dono (admin_set_store_user_role); o convite não
--   é caminho para reativar quem foi desativado.
create function admin_link_existing_user(p_store_id uuid, p_email text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_email text := lower(trim(p_email));
  v_contas uuid[];
  v_id uuid;
begin
  perform jm_require_role(p_store_id, array['owner']);

  if p_role is null or p_role not in ('owner', 'manager', 'waiter', 'kitchen') then
    raise exception 'papel invalido' using errcode = 'JM422';
  end if;
  if v_email is null
     or length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'e-mail invalido' using errcode = 'JM422';
  end if;

  select array_agg(u.id) into v_contas
    from auth.users u
   where lower(u.email) = v_email;

  if coalesce(cardinality(v_contas), 0) = 0 then
    raise exception 'nenhuma conta com este e-mail' using errcode = 'JM404';
  end if;
  if cardinality(v_contas) > 1 then
    raise exception 'mais de uma conta com este e-mail' using errcode = 'JM422';
  end if;

  if exists (
    select 1 from public.store_users su
     where su.store_id = p_store_id and su.user_id = v_contas[1]
  ) then
    raise exception 'esta conta ja esta na lista de usuarios da loja' using errcode = 'JM409';
  end if;

  insert into public.store_users (store_id, user_id, role)
  values (p_store_id, v_contas[1], p_role)
  returning store_users.id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'esta conta ja esta na lista de usuarios da loja' using errcode = 'JM409';
end;
$fn$;

-- ============================================================
-- 4. Quem executa o quê
-- ============================================================

revoke execute on function admin_update_store_idle_alert(uuid, int) from public, anon, authenticated;
revoke execute on function admin_menu_panel(uuid, date) from public, anon, authenticated;
revoke execute on function admin_link_existing_user(uuid, text, text) from public, anon, authenticated;

grant execute on function admin_update_store_idle_alert(uuid, int) to authenticated;
grant execute on function admin_menu_panel(uuid, date) to authenticated;
grant execute on function admin_link_existing_user(uuid, text, text) to authenticated;

commit;
