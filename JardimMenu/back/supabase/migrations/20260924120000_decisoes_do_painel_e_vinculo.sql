-- Três decisões do dono do produto em 24/09/2026, sobre o painel do cardápio (JM-062) e o
-- vínculo de conta existente (JM-052).
--
-- 1. NASCE A LISTA "MERECE DESTAQUE".
--    A pergunta era o que fazer com produto que foi pedido e não tem registro de impressão.
--    A resposta do dono do produto reenquadrou o problema: produto que VENDE e aparece
--    pouco não é candidato a sair do cardápio, é candidato a SUBIR. Ele estava indo parar
--    em "nunca vistos", que é a lista que o dono da casa olha para decidir o que tirar —
--    exatamente o contrário do que os números dizem.
--
--    Então: quem aparece pouco (ou nada) MAS tem pedido sai de "nunca vistos" e de "pouco
--    vistos", e vai para `deserve_highlight`, com a leitura pronta na tela: "pedido X vezes
--    em apenas Y aparições".
--
--    Na Fase B todo pedido passa pelo tablet, então impressão zero com pedido é quase
--    sempre evento de pixel perdido (tablet sem rede, aparelho desligado antes de subir o
--    evento). A lista serve para os dois casos, e continua valendo quando a Fase C trouxer
--    o pedido lançado pelo garçom, em que o produto realmente vende fora da tela.
--
-- 2. A RÉGUA DE "POUCO VISTO" PASSA A SER DE CADA LOJA.
--    Era uma constante de 25% da mediana. O dono do produto pediu que fosse parâmetro:
--    "vai variar de acordo com o perfil do tamanho da casa... cada pessoa pode parametrizar
--    dentro do que ele acha melhor, é como um alerta". A lógica fica igual (zero aparições
--    ou até uma fração da mediana do turno); o que muda é quem escolhe a fração.
--
-- 3. O CONVITE PARA QUEM JÁ ESTEVE NA LOJA REATIVA O VÍNCULO.
--    Era conflito (JM409), e o dono tinha de ir reativar na lista de usuários. Decisão:
--    reativa direto, com o papel pedido. É o caso do garçom que saiu e voltou.
--
--    A trava do último dono continua onde estava, em admin_set_store_user_role: reativar
--    não remove ninguém, então ela não é contornada por aqui. O que esta função passa a
--    poder fazer é devolver alguém à loja com papel diferente do que tinha — e quem faz
--    isso é o dono, que é o único que chega a esta função.

-- ---------------------------------------------------------------------------
-- 1. A régua do painel, por loja
-- ---------------------------------------------------------------------------

alter table public.stores
  add column if not exists menu_panel_low_view_pct int not null default 25;

-- 1 a 100 por cento da mediana. Zero desligaria a lista sem dizer, e acima de 100 marcaria
-- como "pouco visto" produto que apareceu mais que a mediana, o que não quer dizer nada.
alter table public.stores
  drop constraint if exists stores_menu_panel_low_view_pct_ck;
alter table public.stores
  add constraint stores_menu_panel_low_view_pct_ck
  check (menu_panel_low_view_pct between 1 and 100);

comment on column public.stores.menu_panel_low_view_pct is
  'Painel do cardápio (JM-062): porcentagem da mediana de impressões do turno abaixo da qual o produto entra em "pouco visto". Decisão do PO em 24/09/2026: é da casa, não do sistema.';

create or replace function admin_update_store_menu_panel_rule(p_store_id uuid, p_pct int)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  -- Recusa aqui, antes do CHECK da tabela, para a mensagem dizer o que fazer em vez de
  -- devolver o nome de uma constraint.
  if p_pct is null or p_pct < 1 or p_pct > 100 then
    raise exception 'a régua do painel vai de 1 a 100 por cento da mediana' using errcode = 'JM422';
  end if;

  update public.stores
     set menu_panel_low_view_pct = p_pct
   where id = p_store_id;
end;
$fn$;

revoke execute on function admin_update_store_menu_panel_rule(uuid, int) from public, anon, authenticated;
grant execute on function admin_update_store_menu_panel_rule(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. O painel, com a lista nova e a régua da loja
-- ---------------------------------------------------------------------------

create or replace function admin_menu_panel(p_store_id uuid, p_business_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  c_limite_campeoes constant int := 10;
  v_fracao numeric;
  v_hoje date;
  v_dia date;
  v_painel jsonb;
begin
  perform jm_require_role(p_store_id, array['owner', 'manager']);

  select s.menu_panel_low_view_pct::numeric / 100 into v_fracao
    from public.stores s where s.id = p_store_id;
  v_fracao := coalesce(v_fracao, 0.25);

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
           -- Aparece pouco E vende: sai das duas listas de "revisar" e vira destaque.
           -- Sem impressão nenhuma também entra, porque vender sem ter sido visto é o caso
           -- mais forte de todos: ou o pixel se perdeu, ou o produto vende fora da tela.
           (b.pedidos > 0
            and b.impressoes <= coalesce((select r.mediana from regua r), 0) * v_fracao) as merece_destaque,
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
                      'low_view_fraction', v_fracao,
                      'median_impressions', r.mediana,
                      'low_view_max', r.mediana * v_fracao,
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
           -- Vende e some do cardápio: os mais vendidos primeiro, porque é por eles que
           -- vale mexer na ordem das telas.
           'deserve_highlight', coalesce((
             select jsonb_agg(l.j order by l.pedidos desc, l.impressoes, l.name)
               from linhas l
              where l.merece_destaque
           ), '[]'::jsonb),
           'never_seen', coalesce((
             select jsonb_agg(l.j order by l.no_cardapio desc, l.categoria, l.name)
               from linhas l
              where l.impressoes = 0
                and not l.merece_destaque
           ), '[]'::jsonb),
           'low_seen', coalesce((
             select jsonb_agg(l.j order by l.impressoes, l.name)
               from linhas l, regua r
              where l.impressoes > 0
                and l.impressoes <= r.mediana * v_fracao
                and not l.merece_destaque
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

revoke execute on function admin_menu_panel(uuid, date) from public, anon, authenticated;
grant execute on function admin_menu_panel(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. O convite reativa o vínculo desativado
-- ---------------------------------------------------------------------------

create or replace function admin_link_existing_user(p_store_id uuid, p_email text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_email text := lower(trim(p_email));
  v_contas uuid[];
  v_id uuid;
  v_ativo boolean;
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

  select su.id, su.is_active into v_id, v_ativo
    from public.store_users su
   where su.store_id = p_store_id and su.user_id = v_contas[1];

  if v_id is not null then
    -- Já está na loja e ATIVO: não há o que fazer, e trocar papel por aqui seria um
    -- segundo caminho para isso, fora da tela de usuários. Segue conflito.
    if v_ativo then
      raise exception 'esta conta ja esta ativa na lista de usuarios da loja' using errcode = 'JM409';
    end if;

    -- Desativado: é o garçom que saiu e voltou. Reativa com o papel pedido (decisão do PO
    -- em 24/09/2026). Não remove ninguém, então a trava do último dono não é contornada.
    update public.store_users
       set is_active = true,
           role = p_role
     where id = v_id;
    return v_id;
  end if;

  insert into public.store_users (store_id, user_id, role)
  values (p_store_id, v_contas[1], p_role)
  returning store_users.id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function admin_link_existing_user(uuid, text, text) from public, anon, authenticated;
grant execute on function admin_link_existing_user(uuid, text, text) to authenticated;
