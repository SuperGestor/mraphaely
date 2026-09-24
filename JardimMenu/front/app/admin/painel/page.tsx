"use client";

import { useCallback, useEffect, useState } from "react";
import { mensagemDe } from "@/lib/admin-source";
import {
  MAXIMO_DA_REGUA,
  MINIMO_DA_REGUA,
  lerDestaque,
  lerPainel,
  lerRegua,
  painelVazio,
  porcentagemDaRegua,
  rotuloDaRegua,
  rotuloDeConversao,
  rotuloDoTurno,
  type LinhaDoPainel,
  type PainelDoCardapio,
} from "@/lib/painel-do-cardapio";
import { useAdmin } from "@/components/admin/AdminContext";
import { Badge, Button, Cell, Field, Hint, PageHeader, Panel, Row, Table, TextInput } from "@/components/admin/ui";

/**
 * Painel do cardápio (JM-062, P9): o que o cliente vê, o que ele toca e o que ele pede,
 * por turno, em cinco listas — merece destaque, nunca vistos, pouco vistos, vistos sem
 * conversão e campeões de conversão.
 *
 * "Merece destaque" vem primeiro de propósito (decisão do PO em 24/09/2026): é a única que
 * pede para o produto SUBIR no cardápio, e as outras pedem para rever ou tirar. Quem está
 * nela foi tirado de "nunca vistos" e de "pouco vistos" pela própria function, porque
 * produto que vende não é candidato a sair.
 *
 * Só dono e gestor, como o requisito pede. A defesa de verdade é a function
 * `admin_menu_panel`, que confere o papel no banco; a tela recusa antes só para o garçom
 * não abrir uma página que vai falhar. O item também não aparece no menu (AdminShell).
 *
 * Quem decide o turno é o banco, com `shift_date` (D12, regra 5 do CLAUDE.md): a tela
 * nunca manda "hoje", manda nulo, e anda para trás e para a frente com as datas que o
 * próprio painel devolve. A régua de "pouco visto" segue o mesmo caminho: a tela grava a
 * porcentagem e relê o painel, em vez de recalcular a lista aqui.
 */
const numero = new Intl.NumberFormat("pt-BR");

export default function AdminPainel() {
  const { source, loja, gestor } = useAdmin();
  const [turno, setTurno] = useState<string | null>(null);
  const [painel, setPainel] = useState<PainelDoCardapio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  /** A régua gravada e o que está sendo digitado, separados, como em Mesas. */
  const [regua, setRegua] = useState("");
  const [problemaDaRegua, setProblemaDaRegua] = useState<string | null>(null);
  const [avisoDaRegua, setAvisoDaRegua] = useState<string | null>(null);
  const [gravandoRegua, setGravandoRegua] = useState(false);

  const carregar = useCallback(() => {
    if (!gestor) return;
    setCarregando(true);
    setErro(null);
    source
      .rpc("admin_menu_panel", { p_store_id: loja.store_id, p_business_date: turno })
      .then((r) => {
        const lido = lerPainel(r);
        setPainel(lido);
        // O campo sempre volta ao que está gravado: quem manda na régua é o banco, e um
        // número digitado e não gravado não pode parecer valer.
        setRegua(String(porcentagemDaRegua(lido.rules)));
        setProblemaDaRegua(null);
        setAvisoDaRegua(null);
      })
      .catch((e: unknown) => setErro(mensagemDe(e)))
      .finally(() => setCarregando(false));
  }, [source, loja.store_id, turno, gestor]);

  useEffect(carregar, [carregar]);

  /**
   * Grava a régua da casa e relê o painel, para o dono ver a lista mudar. A faixa é
   * conferida aqui só para não ir ao servidor com número impossível; quem recusa de
   * verdade é `admin_update_store_menu_panel_rule`, com JM422, e depois dela o CHECK.
   */
  async function gravarRegua() {
    const leitura = lerRegua(regua);
    if (!leitura.ok) {
      setProblemaDaRegua(leitura.problema);
      return;
    }
    setProblemaDaRegua(null);
    setAvisoDaRegua(null);
    setGravandoRegua(true);
    try {
      await source.rpc("admin_update_store_menu_panel_rule", { p_store_id: loja.store_id, p_pct: leitura.pct });
      setAvisoDaRegua(`Régua gravada em ${leitura.pct}%. Ela vale para todos os turnos que você abrir aqui.`);
      carregar();
    } catch (e: unknown) {
      // Pelo canal de PROBLEMA, e não pelo de aviso: o dono precisa ver que não gravou, e o
      // campo volta ao que está valendo, para o número recusado não ficar em pé como se
      // fosse a régua da casa.
      setProblemaDaRegua(mensagemDe(e));
      if (painel) setRegua(String(porcentagemDaRegua(painel.rules)));
    } finally {
      setGravandoRegua(false);
    }
  }

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
              <Destaques linhas={painel.deserve_highlight} semMovimento={painel.totals.impressions === 0} />

              <ReguaDaCasa
                painel={painel}
                valor={regua}
                problema={problemaDaRegua}
                aviso={avisoDaRegua}
                gravando={gravandoRegua}
                onMudar={(v) => {
                  setRegua(v);
                  setProblemaDaRegua(null);
                }}
                onGravar={() => void gravarRegua()}
              />

              <Lista
                titulo="Nunca vistos"
                descricao="Ninguém abriu a tela com estes produtos neste turno, e nenhum deles foi pedido. Vale rever a posição na categoria, a foto e o nome."
                vazio="Todo produto do cardápio apareceu para alguém neste turno."
                linhas={painel.never_seen}
              />
              <Lista
                titulo="Pouco vistos"
                descricao={'Apareceram na tela abaixo da régua da casa, logo acima, e nenhum deles foi pedido. Quem aparece pouco mas vende não entra aqui: está em "Merece destaque".'}
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

/**
 * Merece destaque. Cartão, e não linha de tabela, porque esta lista é lida no celular
 * entre uma mesa e outra: o que ela precisa entregar é a frase ("pedido 5 vezes em apenas
 * 6 aparições"), e não oito colunas de número para o dono comparar de cabeça.
 */
function Destaques({ linhas, semMovimento }: { linhas: LinhaDoPainel[]; semMovimento: boolean }) {
  const algumSemRegistro = linhas.some((l) => l.impressions === 0);

  return (
    <Panel
      titulo={`Merece destaque · ${numero.format(linhas.length)}`}
      descricao="Vende e quase não aparece na tela do cliente. É a única lista que pede para subir o produto, e não para rever ou tirar."
    >
      {linhas.length === 0 ? (
        <p className="text-base">
          {semMovimento
            ? "Ainda não chegou registro de nenhuma aparição neste turno. Quando o movimento começar, quem estiver vendendo sem aparecer na tela cai aqui."
            : "Nenhum produto está vendendo escondido neste turno: o que a casa vende está aparecendo na tela. Isso é boa notícia, e não falta de dado."}
        </p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {linhas.map((l) => {
              const { frase, semRegistro } = lerDestaque(l);
              return (
                <li key={l.product_id} className="rounded-input bg-canvas p-4">
                  <p className="text-base font-bold">{l.name}</p>
                  <p className="text-muted mt-0.5 text-sm">{l.category}</p>
                  <p className="mt-3 text-base">{frase}</p>
                  <p className="text-muted mt-2 text-sm">
                    {l.in_menu
                      ? "Considere subir no cardápio: um lugar mais alto na categoria, ou marcado como destaque."
                      : "Este produto está fora do cardápio e mesmo assim vendeu. Vale conferir se saiu de lá sem querer."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {l.in_menu ? null : <Badge tom="alerta">fora do cardápio</Badge>}
                    {semRegistro ? (
                      <Badge>sem registro de aparição</Badge>
                    ) : (
                      <Badge tom="ok">{rotuloDeConversao(l.conversion)} de quem viu pediu</Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {algumSemRegistro ? (
            <div className="mt-4">
              <Hint>
                <strong>Produto pedido sem nenhuma aparição registrada não tem conversão para mostrar.</strong> Hoje todo
                pedido passa pelo tablet da mesa, então isso costuma ser o registro que se perdeu quando o aparelho ficou
                sem rede — mas o pedido aconteceu. Por isso o produto aparece aqui, e não em &ldquo;nunca vistos&rdquo;.
              </Hint>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/**
 * A régua da casa (decisão do PO em 24/09/2026). O dono muda a porcentagem aqui e o painel
 * é relido, então a lista muda na frente dele.
 *
 * A tela não simula o número antes de gravar de propósito: quem separa "pouco visto" de
 * "merece destaque" é a function, e uma segunda conta em JavaScript poderia mostrar um
 * efeito diferente do que a lista logo abaixo está mostrando.
 */
function ReguaDaCasa({
  painel,
  valor,
  problema,
  aviso,
  gravando,
  onMudar,
  onGravar,
}: {
  painel: PainelDoCardapio;
  valor: string;
  problema: string | null;
  aviso: string | null;
  gravando: boolean;
  onMudar: (v: string) => void;
  onGravar: () => void;
}) {
  const gravada = porcentagemDaRegua(painel.rules);

  return (
    <Panel
      titulo="A régua da casa"
      descricao="A partir de quantas aparições um produto deixa de contar como pouco visto. O que é pouco numa casa de dez mesas não é pouco numa de cem."
    >
      <p className="text-base">{rotuloDaRegua(painel.rules)}</p>
      <p className="text-muted mt-2 text-sm">
        A régua é comparada com a mediana do próprio turno, e por isso continua valendo na casa cheia e na vazia. Ela é
        um aviso para você: não esconde nada do cliente e não muda o cardápio da mesa.
      </p>

      <div className="mt-4 grid gap-4 min-[1100px]:grid-cols-[1fr_2fr_auto] min-[1100px]:items-end">
        <Field
          rotulo="Porcentagem da mediana"
          ajuda={`De ${MINIMO_DA_REGUA}% a ${MAXIMO_DA_REGUA}%.`}
          erro={problema}
        >
          <TextInput
            inputMode="numeric"
            value={valor}
            disabled={gravando}
            aria-label="Porcentagem da régua do painel do cardápio"
            onChange={(e) => onMudar(e.target.value)}
          />
        </Field>
        <div className="mb-6">
          <p className="text-base">
            Hoje a régua está gravada em <strong className="tabular-nums">{numero.format(gravada)}%</strong>.
          </p>
          <p className="text-muted mt-1 text-sm">
            Quanto maior a porcentagem, mais produtos entram nas listas de pouco visto e de merece destaque.
          </p>
        </div>
        <div className="mb-6">
          <Button onClick={onGravar} disabled={gravando || valor.trim() === String(gravada)}>
            {gravando ? "Gravando…" : "Gravar régua"}
          </Button>
        </div>
      </div>

      {aviso ? (
        <div role="status">
          <Hint>{aviso}</Hint>
        </div>
      ) : null}
    </Panel>
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
