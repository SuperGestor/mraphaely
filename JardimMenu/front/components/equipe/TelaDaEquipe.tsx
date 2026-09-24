"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LojaDoUsuario } from "@/lib/admin-source";
import { getEquipeSource, type AcaoDaEquipe } from "@/lib/equipe-source";
import { money } from "@/lib/money";
import {
  bateriaBaixa,
  mesaParada,
  minutosEntre,
  pedidosRecentes,
  rotuloDeTempo,
  tabletSemContato,
  totalDaMesa,
  type CancelamentoPendente,
  type MesaNoSalao,
  type Salao,
} from "@/lib/salao";
import { DetalheDaMesa } from "./DetalheDaMesa";
import { PedidoDaEquipe } from "./PedidoDaEquipe";
import { useSom } from "./useSom";

/**
 * Tela da equipe da primeira versão (JM-121, D23, D30). Funciona em celular, tablet e
 * computador.
 *
 * - O retrato do salão vem inteiro de `staff_floor`. O Realtime (só aqui, nunca no tablet)
 *   avisa que algo mudou, e a tela relê o retrato: o evento não carrega dado, então a RLS
 *   de leitura e a function continuam sendo o único filtro.
 * - Sem Realtime de pé, a releitura de segurança fica a cada 10 s; com ele, a cada 15 s,
 *   que também atualiza o que não é publicado (o último contato do tablet).
 * - Pedido novo, chamado e pedido de cancelamento tocam som, depois de "Ativar som".
 */

/**
 * Releitura de segurança com o Realtime de pé. Era 60 s, e virou 15 s em 23/09/2026.
 *
 * O motivo: "ao vivo" quer dizer que o canal foi aceito, e NÃO que todo evento vai chegar.
 * Na esteira, o servidor de Realtime recém-subido aceitou a assinatura e engoliu o evento
 * do primeiro pedido — a tela ficou com "Nenhum pedido novo" e a mesa como livre, com o
 * pedido já gravado no banco. Isso acontece justamente depois de uma publicação, que é
 * quando a pilha reinicia e a tela da equipe costuma estar aberta no salão.
 *
 * Com 60 s, um evento perdido escondia um pedido por um minuto inteiro, e o requisito da
 * tela é 2 s (NF-003). Com 15 s, o caminho normal continua sendo o Realtime, em menos de
 * 2 s, e o pior caso passa a ser 15 s. O custo é quatro leituras por minuto em vez de uma,
 * em meia dúzia de aparelhos da casa: barato perto de um pedido que ninguém viu.
 */
const RELEITURA_COM_REALTIME_MS = 15_000;
const RELEITURA_SEM_REALTIME_MS = 10_000;
/** "Pedidos recentes": o que a equipe ainda pode estar lançando no PDV. */
const RECENTES_MIN = 20;
/** Pedido novo fica marcado no cartão da mesa por este tempo. */
const NOVO_MIN = 5;

export function TelaDaEquipe() {
  const fonte = getEquipeSource();
  const [loja, setLoja] = useState<LojaDoUsuario | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [salao, setSalao] = useState<Salao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semRede, setSemRede] = useState(false);
  const [aoVivo, setAoVivo] = useState(false);
  const [mesaAberta, setMesaAberta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Diferença entre o relógio do banco e o do aparelho, para "há X min" andar sozinho. */
  const [desvio, setDesvio] = useState(0);
  const [agora, setAgora] = useState(() => new Date().toISOString());
  const som = useSom();

  const conhecidos = useRef<Set<string> | null>(null);
  const tocarRef = useRef(som.tocar);
  useEffect(() => {
    tocarRef.current = som.tocar;
  });

  useEffect(() => {
    fonte
      .contexto()
      .then((c) => {
        setEmail(c.email);
        const primeira = c.lojas[0];
        if (!primeira) setErro("Seu usuário não está ativo em nenhuma loja. Peça ao dono da casa para te convidar.");
        else setLoja(primeira);
      })
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível abrir a tela."));
  }, [fonte]);

  /** Som para o que é novo desde o último retrato; o primeiro retrato só registra. */
  const detectarNovidades = useCallback((s: Salao) => {
    const ids = new Set<string>();
    let pedidoNovo = false;
    let chamadoNovo = false;
    for (const m of s.tables) {
      for (const c of m.calls) {
        ids.add(`c:${c.id}`);
        if (conhecidos.current && !conhecidos.current.has(`c:${c.id}`)) chamadoNovo = true;
      }
      for (const t of m.session?.tabs ?? []) {
        for (const o of t.orders) {
          ids.add(`o:${o.id}`);
          if (conhecidos.current && !conhecidos.current.has(`o:${o.id}`)) pedidoNovo = true;
        }
      }
    }
    for (const r of s.cancel_requests) {
      ids.add(`r:${r.id}`);
      if (conhecidos.current && !conhecidos.current.has(`r:${r.id}`)) chamadoNovo = true;
    }
    conhecidos.current = ids;
    if (chamadoNovo) tocarRef.current("chamado");
    else if (pedidoNovo) tocarRef.current("pedido");
  }, []);

  const recarregar = useCallback(async () => {
    if (!loja) return;
    try {
      const s = await fonte.salao(loja.store_id);
      setSalao(s);
      setSemRede(false);
      setDesvio(new Date(s.now).getTime() - Date.now());
      setAgora(s.now);
      detectarNovidades(s);
    } catch (e) {
      const codigo = (e as { codigo?: string }).codigo;
      if (codigo === "REDE") setSemRede(true);
      else if (codigo === "JM403") setErro("Seu papel nesta loja não usa a tela da equipe.");
      else setAviso(e instanceof Error ? e.message : "Falha ao atualizar o salão.");
    }
  }, [fonte, loja, detectarNovidades]);

  // Primeira leitura e assinatura do Realtime. Eventos em rajada viram uma releitura só.
  useEffect(() => {
    if (!loja) return;
    void recarregar();
    let espera: ReturnType<typeof setTimeout> | null = null;
    const mudou = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(() => void recarregar(), 250);
    };
    let desligar = () => {};
    try {
      desligar = fonte.assinar(loja.store_id, mudou, setAoVivo);
    } catch {
      setAoVivo(false);
    }
    return () => {
      if (espera) clearTimeout(espera);
      desligar();
    };
  }, [fonte, loja, recarregar]);

  // Releitura de segurança (NF-003: a tela funciona com o Realtime desligado à força).
  useEffect(() => {
    if (!loja) return;
    const relogio = setInterval(() => void recarregar(), aoVivo ? RELEITURA_COM_REALTIME_MS : RELEITURA_SEM_REALTIME_MS);
    const voltou = () => void recarregar();
    window.addEventListener("online", voltou);
    return () => {
      clearInterval(relogio);
      window.removeEventListener("online", voltou);
    };
  }, [loja, aoVivo, recarregar]);

  // "Há X min" anda com o relógio do banco, corrigido pelo desvio.
  useEffect(() => {
    const relogio = setInterval(() => setAgora(new Date(Date.now() + desvio).toISOString()), 20_000);
    return () => clearInterval(relogio);
  }, [desvio]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const executar = useCallback(
    async (a: AcaoDaEquipe) => {
      const r = await fonte.executar(a);
      const fechou = (r as { session_closed?: boolean; origin_closed?: boolean } | null) ?? null;
      if (fechou?.session_closed || fechou?.origin_closed) setAviso("A mesa ficou livre.");
      await recarregar();
      return r;
    },
    [fonte, recarregar],
  );

  const salaoAgora = useMemo(() => (salao ? { ...salao, now: agora } : null), [salao, agora]);
  const chamados = useMemo(
    () =>
      (salaoAgora?.tables ?? [])
        .flatMap((m) => m.calls.map((c) => ({ mesa: m, chamado: c })))
        .sort((a, b) => a.chamado.created_at.localeCompare(b.chamado.created_at)),
    [salaoAgora],
  );
  const recentes = useMemo(() => (salaoAgora ? pedidosRecentes(salaoAgora, RECENTES_MIN) : []), [salaoAgora]);
  const mesa = salaoAgora?.tables.find((m) => m.id === mesaAberta) ?? null;

  if (erro) {
    return (
      <main className="mx-auto max-w-xl p-6 text-center">
        <p className="text-xl font-semibold">{erro}</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="bg-primary sticky top-0 z-30 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold">Salão · {loja?.nome ?? "carregando"}</h1>
            <p className="truncate text-sm text-white/75">
              {email ?? (fonte.modo === "exemplo" ? "modo de exemplo" : "")}
              {" · "}
              <span role="status">{semRede ? "sem conexão" : aoVivo ? "ao vivo" : "atualiza a cada 10 s"}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={som.alternar}
            aria-pressed={som.ligado}
            className={`jm-touch jm-focus rounded-full px-4 text-base font-semibold ${som.ligado ? "bg-white/15 text-white" : "text-ink bg-white"}`}
          >
            {som.ligado ? "Som ligado" : "Ativar som"}
          </button>
          {fonte.modo === "real" ? (
            <form action="/api/admin/sair" method="post">
              <button type="submit" className="jm-touch jm-focus rounded-full px-3 text-base text-white/85 underline">
                Sair
              </button>
            </form>
          ) : null}
        </div>
      </header>

      {fonte.modo === "exemplo" ? (
        <div className="bg-accent px-4 py-2 text-center text-sm font-semibold text-white" role="status">
          Modo de exemplo: salão fictício, e nada é gravado.
        </div>
      ) : null}
      {semRede ? (
        <div className="bg-danger px-4 py-2 text-center text-base font-semibold text-white" role="alert">
          Sem conexão. A tela mostra o último retrato e tenta de novo sozinha.
        </div>
      ) : null}

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6">
        {!salaoAgora ? (
          <p className="text-muted py-10 text-center text-base">Carregando o salão…</p>
        ) : (
          <>
            {chamados.length > 0 || salaoAgora.cancel_requests.length > 0 ? (
              <section aria-labelledby="atencao">
                <h2 id="atencao" className="mb-3 text-lg font-bold">
                  Precisa de atenção
                </h2>
                <ul className="grid gap-3 md:grid-cols-2">
                  {chamados.map(({ mesa: m, chamado: c }) => (
                    <li key={c.id} className="rounded-card bg-danger flex flex-wrap items-center gap-3 p-4 text-white">
                      <div className="min-w-0 flex-1">
                        <p className="text-lg font-bold">Mesa {m.number} chamando</p>
                        <p className="text-sm text-white/85">
                          {rotuloDeTempo(minutosEntre(c.created_at, agora))}
                          {c.reinforced_at ? " · reforçou o chamado" : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void executar({ acao: "atender", corpo: { call_id: c.id } }).catch((e: Error) => setAviso(e.message))}
                        className="jm-touch jm-focus text-ink rounded-full bg-white px-5 text-base font-bold"
                      >
                        Atender
                      </button>
                    </li>
                  ))}
                  {salaoAgora.cancel_requests.map((r) => (
                    <PedidoDeCancelamento key={r.id} req={r} agora={agora} executar={executar} onErro={setAviso} />
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="mesas">
              <h2 id="mesas" className="mb-3 text-lg font-bold">
                Mesas
              </h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {salaoAgora.tables.map((m) => (
                  <li key={m.id}>
                    <CartaoDaMesa mesa={m} salao={salaoAgora} onAbrir={() => setMesaAberta(m.id)} />
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="recentes">
              <h2 id="recentes" className="mb-3 text-lg font-bold">
                Pedidos dos últimos {RECENTES_MIN} min
              </h2>
              {recentes.length === 0 ? (
                <p className="text-muted text-base">Nenhum pedido novo.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {recentes.map(({ mesa: m, comanda, pedido }) => (
                    <PedidoDaEquipe
                      key={pedido.id}
                      pedido={pedido}
                      agora={agora}
                      cabecalho={`Mesa ${m.number}${comanda.name !== "Mesa" ? ` · ${comanda.name}` : ""}`}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {mesa && salaoAgora ? (
        <DetalheDaMesa mesa={mesa} salao={salaoAgora} agora={agora} executar={executar} onFechar={() => setMesaAberta(null)} />
      ) : null}

      {aviso ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-center p-4">
          <p className="rounded-card bg-ink shadow-float pointer-events-auto max-w-md px-4 py-3 text-base font-semibold text-white" role="status">
            {aviso}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PedidoDeCancelamento({
  req,
  agora,
  executar,
  onErro,
}: {
  req: CancelamentoPendente;
  agora: string;
  executar: (a: AcaoDaEquipe) => Promise<unknown>;
  onErro: (m: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const decidir = (aprovar: boolean) => {
    setOcupado(true);
    executar({ acao: "decidir", corpo: { request_id: req.id, aprovar, nota: null } })
      .catch((e: Error) => onErro(e.message))
      .finally(() => setOcupado(false));
  };
  const alvo = req.item_id ? `${req.item_quantity ?? 1}× ${req.item_name ?? "item"}` : "o pedido inteiro";
  return (
    <li className="rounded-card bg-surface border-accent border-2 p-4">
      <p className="text-lg font-bold">
        Mesa {req.table_number}
        {req.tab_name !== "Mesa" ? ` · ${req.tab_name}` : ""} pede cancelamento
      </p>
      <p className="text-base">
        {alvo}, do pedido nº {req.display_number}
      </p>
      <p className="text-muted text-sm">{rotuloDeTempo(minutosEntre(req.requested_at, agora))}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => decidir(true)}
          className="jm-touch jm-focus bg-primary flex-1 rounded-full px-4 text-base font-bold text-white disabled:opacity-45"
        >
          Aprovar
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => decidir(false)}
          className="jm-touch jm-focus border-line flex-1 rounded-full border-2 px-4 text-base font-semibold disabled:opacity-45"
        >
          Recusar
        </button>
      </div>
    </li>
  );
}

function CartaoDaMesa({ mesa, salao, onAbrir }: { mesa: MesaNoSalao; salao: Salao; onAbrir: () => void }) {
  const chamando = mesa.calls.length > 0;
  const cancelamento = salao.cancel_requests.some((r) => r.table_number === mesa.number);
  const novo = (mesa.session?.tabs ?? []).some((t) => t.orders.some((o) => minutosEntre(o.created_at, salao.now) < NOVO_MIN));
  const selos = [
    chamando ? { texto: "chamando", cor: "bg-danger text-white" } : null,
    cancelamento ? { texto: "cancelamento", cor: "bg-accent text-white" } : null,
    novo ? { texto: "pedido novo", cor: "bg-primary text-white" } : null,
    mesaParada(mesa, salao) ? { texto: "parada", cor: "bg-ink text-white" } : null,
    !mesa.ordering_enabled ? { texto: "pedido pausado", cor: "bg-ink text-white" } : null,
    !mesa.device ? { texto: "sem tablet", cor: "bg-canvas" } : null,
    tabletSemContato(mesa, salao) ? { texto: "tablet sem contato", cor: "bg-danger text-white" } : null,
    bateriaBaixa(mesa) ? { texto: `bateria ${mesa.device?.battery_level}%`, cor: "bg-danger text-white" } : null,
  ].filter((s): s is { texto: string; cor: string } => s !== null);

  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`jm-focus rounded-card bg-surface shadow-card flex h-full min-h-28 w-full flex-col items-start gap-2 border-2 p-3 text-left ${
        chamando ? "border-danger" : cancelamento ? "border-accent" : "border-transparent"
      }`}
    >
      <span className="flex w-full items-baseline justify-between gap-2">
        <span className="text-2xl font-bold tabular-nums">{mesa.number}</span>
        <span className="text-muted text-sm tabular-nums">{mesa.session ? money(totalDaMesa(mesa)) : "livre"}</span>
      </span>
      {mesa.session && mesa.session.tabs.length > 1 ? <span className="text-muted text-sm">{mesa.session.tabs.length} comandas</span> : null}
      <span className="flex flex-wrap gap-1">
        {selos.map((s) => (
          <span key={s.texto} className={`rounded-full px-2 py-0.5 text-xs font-bold ${s.cor}`}>
            {s.texto}
          </span>
        ))}
      </span>
    </button>
  );
}
