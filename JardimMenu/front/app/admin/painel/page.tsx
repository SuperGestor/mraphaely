"use client";

import { useCallback, useEffect, useState } from "react";
import { mensagemDe } from "@/lib/admin-source";
import {
  lerPainel,
  painelVazio,
  rotuloDeConversao,
  rotuloDoTurno,
  type LinhaDoPainel,
  type PainelDoCardapio,
} from "@/lib/painel-do-cardapio";
import { useAdmin } from "@/components/admin/AdminContext";
import { Badge, Button, Cell, Hint, PageHeader, Panel, Row, Table } from "@/components/admin/ui";

/**
 * Painel do cardápio (JM-062, P9): o que o cliente vê, o que ele toca e o que ele pede,
 * por turno, em quatro listas — nunca vistos, pouco vistos, vistos sem conversão e
 * campeões de conversão.
 *
 * Só dono e gestor, como o requisito pede. A defesa de verdade é a function
 * `admin_menu_panel`, que confere o papel no banco; a tela recusa antes só para o garçom
 * não abrir uma página que vai falhar. O item também não aparece no menu (AdminShell).
 *
 * Quem decide o turno é o banco, com `shift_date` (D12, regra 5 do CLAUDE.md): a tela
 * nunca manda "hoje", manda nulo, e anda para trás e para a frente com as datas que o
 * próprio painel devolve.
 */
const numero = new Intl.NumberFormat("pt-BR");

export default function AdminPainel() {
  const { source, loja, gestor } = useAdmin();
  const [turno, setTurno] = useState<string | null>(null);
  const [painel, setPainel] = useState<PainelDoCardapio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(() => {
    if (!gestor) return;
    setCarregando(true);
    setErro(null);
    source
      .rpc("admin_menu_panel", { p_store_id: loja.store_id, p_business_date: turno })
      .then((r) => setPainel(lerPainel(r)))
      .catch((e: unknown) => setErro(mensagemDe(e)))
      .finally(() => setCarregando(false));
  }, [source, loja.store_id, turno, gestor]);

  useEffect(carregar, [carregar]);

  if (!gestor) {
    return (
      <>
        <PageHeader titulo="Painel do cardápio" />
        <Hint>Este painel é do dono e do gestor da casa. Peça a eles os números do cardápio.</Hint>
      </>
    );
  }

  return (
    <>
      <PageHeader
        titulo="Painel do cardápio"
        descricao="O que o cliente viu, o que ele tocou e o que virou pedido, turno a turno."
      />

      <Panel titulo="Turno">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variante="secundario"
            onClick={() => painel && setTurno(painel.previous_business_date)}
            disabled={!painel || carregando}
          >
            ← Turno anterior
          </Button>
          <p className="text-base font-semibold">
            {painel ? rotuloDoTurno(painel.business_date) : "—"}
            {painel && painel.business_date === painel.current_business_date ? (
              <span className="text-muted ml-2 font-normal">(turno de hoje)</span>
            ) : null}
          </p>
          <Button
            variante="secundario"
            onClick={() => painel?.next_business_date && setTurno(painel.next_business_date)}
            disabled={!painel || carregando || painel.next_business_date === null}
          >
            Turno seguinte →
          </Button>
          {painel && painel.business_date !== painel.current_business_date ? (
            <Button variante="secundario" onClick={() => setTurno(null)} disabled={carregando}>
              Voltar para hoje
            </Button>
          ) : null}
        </div>
        <p className="text-muted mt-3 text-sm">
          O turno é o dia de funcionamento da casa, não o dia do calendário: quem fecha a madrugada no dia certo é o
          banco, com o horário de abertura da loja.
        </p>
      </Panel>

      {erro ? (
        <Panel titulo="Não deu para ler o painel">
          <Hint>{erro}</Hint>
          <div className="mt-4">
            <Button onClick={carregar}>Tentar de novo</Button>
          </div>
        </Panel>
      ) : carregando && !painel ? (
        <Panel>
          <p className="text-muted">Carregando os números do turno…</p>
        </Panel>
      ) : !painel ? null : (
        <>
          <Panel titulo="No turno inteiro">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Total rotulo="Produtos vistos na tela" valor={painel.totals.impressions} />
              <Total rotulo="Toques em produto" valor={painel.totals.clicks} />
              <Total rotulo="Vezes que foi para a sacola" valor={painel.totals.adds_to_cart} />
              <Total rotulo="Pedidos enviados" valor={painel.totals.orders} />
              <Total rotulo="Produtos com ao menos um pedido" valor={painel.totals.ordered_products} />
              <Total rotulo="Produtos no painel" valor={painel.totals.products} />
            </dl>
            <div className="mt-4">
              <Hint>
                <strong>Pedido e conversão vêm dos pedidos de verdade, e não do pixel.</strong> Ser visto, ser tocado e
                ir para a sacola são contados pelo pixel do cardápio; pedido e itens saem dos pedidos enviados, sem os
                cancelados e sem os itens que a equipe removeu. Conversão é pedidos dividido por vezes visto, e cada
                mesa conta uma vez por produto.
              </Hint>
            </div>
          </Panel>

          {painelVazio(painel) ? (
            <Panel titulo="Sem nada para mostrar neste turno">
              <p className="text-base">
                Este turno não tem produto no cardápio nem movimento registrado. Se a casa abriu, confira se os tablets
                estavam pareados e com rede; se o cardápio ainda está vazio, cadastre os produtos em Cardápio.
              </p>
              <div className="mt-4">
                <Button variante="secundario" onClick={() => setTurno(painel.previous_business_date)}>
                  Ver o turno anterior
                </Button>
              </div>
            </Panel>
          ) : (
            <>
              <Lista
                titulo="Nunca vistos"
                descricao="Ninguém abriu a tela com estes produtos neste turno. Vale rever a posição deles na categoria, a foto e o nome."
                vazio="Todo produto do cardápio apareceu para alguém neste turno."
                linhas={painel.never_seen}
              />
              <Lista
                titulo="Pouco vistos"
                descricao={
                  painel.rules.low_view_max === null
                    ? "Produtos bem abaixo do resto em número de visualizações."
                    : `Produtos vistos no máximo ${numero.format(painel.rules.low_view_max)} vez(es), um quarto da mediana do turno (${numero.format(painel.rules.median_impressions ?? 0)}). A régua é relativa ao próprio turno, para valer na casa cheia e na vazia.`
                }
                vazio="Nenhum produto ficou claramente abaixo do resto neste turno."
                linhas={painel.low_seen}
              />
              <Lista
                titulo="Vistos sem conversão"
                descricao="Apareceram para o cliente e não viraram pedido nenhum. É onde preço, descrição e foto costumam pesar."
                vazio="Todo produto visto neste turno teve ao menos um pedido."
                linhas={painel.seen_no_conversion}
              />
              <Lista
                titulo="Campeões de conversão"
                descricao={
                  painel.rules.champion_min_impressions === null
                    ? "Os produtos que mais viram pedido entre os que o cliente viu."
                    : `Maior conversão entre os produtos vistos ao menos ${numero.format(painel.rules.champion_min_impressions)} vez(es), no máximo ${numero.format(painel.rules.champions_limit)}. O piso existe para um produto visto uma vez e pedido uma vez não encabeçar a lista com 100%.`
                }
                vazio="Ainda não há produto com pedido e visualizações suficientes para esta lista."
                linhas={painel.champions}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

function Total({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-input bg-canvas px-4 py-3">
      <dt className="text-muted text-sm">{rotulo}</dt>
      <dd className="text-2xl font-bold tabular-nums">{numero.format(valor)}</dd>
    </div>
  );
}

function Lista({
  titulo,
  descricao,
  vazio,
  linhas,
}: {
  titulo: string;
  descricao: string;
  vazio: string;
  linhas: LinhaDoPainel[];
}) {
  return (
    <Panel titulo={`${titulo} · ${numero.format(linhas.length)}`} descricao={descricao}>
      {linhas.length === 0 ? (
        <p className="text-muted">{vazio}</p>
      ) : (
        <Table colunas={["Produto", "Categoria", "Visto", "Toques", "Na sacola", "Pedidos", "Itens", "Conversão"]}>
          {linhas.map((l) => (
            <Row key={l.product_id}>
              <Cell>
                <span className="font-semibold">{l.name}</span>
                {l.in_menu ? null : (
                  <span className="ml-2 inline-block">
                    <Badge tom="alerta">fora do cardápio</Badge>
                  </span>
                )}
              </Cell>
              <Cell>
                <span className="text-muted">{l.category}</span>
              </Cell>
              <Cell>
                <span className="tabular-nums">{numero.format(l.impressions)}</span>
              </Cell>
              <Cell>
                <span className="tabular-nums">{numero.format(l.clicks)}</span>
              </Cell>
              <Cell>
                <span className="tabular-nums">{numero.format(l.adds_to_cart)}</span>
              </Cell>
              <Cell>
                <span className="tabular-nums">{numero.format(l.orders)}</span>
              </Cell>
              <Cell>
                <span className="tabular-nums">{numero.format(l.quantity)}</span>
              </Cell>
              <Cell>
                <span className="font-semibold tabular-nums">{rotuloDeConversao(l.conversion)}</span>
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </Panel>
  );
}
