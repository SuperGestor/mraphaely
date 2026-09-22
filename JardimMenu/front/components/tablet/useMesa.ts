"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMenuSource } from "@/lib/menu-source";
import type { ComandaAberta, ModoDeComanda, ResumoDaMesa, SessaoDaMesa } from "@/lib/mesa";
import { PedidoRecusado } from "@/lib/sacola";
import { TabletNaoPareado } from "@/lib/tablet-source";

/** Polling do tablet: 10 s é o modo normal, e não um plano B (JM-012, P7). */
export const POLLING_MS = 10_000;

/**
 * A mesa vista pelo tablet: a abertura, as comandas abertas, a comanda ativa e o resumo
 * que o polling traz.
 *
 * - A abertura nasce no primeiro toque (JM-182), por `tocar()`. O envio chama
 *   `garantirMesa()`, que abre se ainda não houver.
 * - O resumo vem a cada 10 s. Falha de rede no polling liga o "sem conexão" (JM-012), e a
 *   próxima volta que der certo desliga sozinha.
 * - A comanda ativa vive só na memória (JM-201). No modo `mesa_unica` ela é a comanda
 *   "Mesa", e o cliente nunca escolhe nada (JM-200). A limpeza entre clientes a zera.
 * - Comanda encerrada ou migrada pela equipe some da lista no polling, e deixa de ser a
 *   ativa.
 */
export function useMesa(ligado: boolean) {
  const [sessao, setSessao] = useState<SessaoDaMesa | null>(null);
  const [resumo, setResumo] = useState<ResumoDaMesa | null>(null);
  const [escolhida, setEscolhida] = useState<ComandaAberta | null>(null);
  const [semConexao, setSemConexao] = useState(false);
  const [naoPareado, setNaoPareado] = useState<TabletNaoPareado | null>(null);

  const abrindo = useRef<Promise<SessaoDaMesa> | null>(null);
  /** Cada escrita local sobe a versão; resposta de polling mais velha que ela é ignorada. */
  const versao = useRef(0);
  const sessaoAtual = useRef<SessaoDaMesa | null>(null);

  /** Estado e referência andam juntos: `garantirMesa` lê a referência sem esperar render. */
  const definirSessao = useCallback((s: SessaoDaMesa | null) => {
    sessaoAtual.current = s;
    setSessao(s);
  }, []);

  const atualizar = useCallback(async () => {
    const inicio = versao.current;
    try {
      const r = await getMenuSource().resumo();
      if (versao.current !== inicio) return;
      setResumo(r);
      setSemConexao(false);
      setNaoPareado(null);
      definirSessao(
        r.session
          ? { session_id: r.session.id, tab_mode: r.tab_mode, tabs: r.tabs.map((t) => ({ id: t.id, name: t.name })) }
          : null,
      );
    } catch (e) {
      if (e instanceof TabletNaoPareado) setNaoPareado(e);
      else if (e instanceof PedidoRecusado && e.codigo === "REDE") setSemConexao(true);
      // Outra falha do servidor não é falta de rede: a próxima volta tenta de novo.
    }
  }, [definirSessao]);

  useEffect(() => {
    if (!ligado) return;
    void atualizar();
    const relogio = setInterval(() => void atualizar(), POLLING_MS);
    const voltou = () => void atualizar();
    const visivel = () => {
      if (document.visibilityState === "visible") void atualizar();
    };
    window.addEventListener("online", voltou);
    document.addEventListener("visibilitychange", visivel);
    return () => {
      clearInterval(relogio);
      window.removeEventListener("online", voltou);
      document.removeEventListener("visibilitychange", visivel);
    };
  }, [ligado, atualizar]);

  const garantirMesa = useCallback(async (): Promise<SessaoDaMesa> => {
    if (sessaoAtual.current) return sessaoAtual.current;
    if (!abrindo.current) {
      abrindo.current = getMenuSource()
        .abrirMesa()
        .then((s) => {
          versao.current += 1;
          definirSessao(s);
          return s;
        })
        .finally(() => {
          abrindo.current = null;
        });
    }
    return abrindo.current;
  }, [definirSessao]);

  /** Primeiro toque no cardápio abre a abertura da mesa (JM-182). Falha aqui é silenciosa. */
  const tocar = useCallback(() => {
    if (!ligado || sessaoAtual.current || abrindo.current) return;
    garantirMesa()
      .then(() => atualizar())
      .catch((e: unknown) => {
        if (e instanceof TabletNaoPareado) setNaoPareado(e);
      });
  }, [ligado, garantirMesa, atualizar]);

  const criarComanda = useCallback(
    async (nome: string): Promise<ComandaAberta> => {
      await garantirMesa();
      const nova = await getMenuSource().criarComanda(nome);
      versao.current += 1;
      const s = sessaoAtual.current;
      definirSessao(
        s && s.session_id === nova.session_id
          ? { ...s, tabs: [...s.tabs, { id: nova.id, name: nova.name }] }
          : { session_id: nova.session_id, tab_mode: "nomeada", tabs: [{ id: nova.id, name: nova.name }] },
      );
      const comanda = { id: nova.id, name: nova.name };
      setEscolhida(comanda);
      void atualizar();
      return comanda;
    },
    [garantirMesa, atualizar, definirSessao],
  );

  /**
   * A abertura ou a comanda mudaram por fora (a equipe fechou a mesa, encerrou ou migrou a
   * comanda). Esquece o que o tablet sabia e relê.
   */
  const esquecerMesa = useCallback(() => {
    versao.current += 1;
    definirSessao(null);
    setEscolhida(null);
    void atualizar();
  }, [atualizar, definirSessao]);

  /** Limpeza entre clientes (JM-183, JM-201): a próxima pessoa escolhe a sua comanda. */
  const zerarComanda = useCallback(() => setEscolhida(null), []);

  const modo: ModoDeComanda = resumo?.tab_mode ?? sessao?.tab_mode ?? "mesa_unica";
  const abas = useMemo(() => sessao?.tabs ?? [], [sessao]);

  const comandaAtiva = useMemo<ComandaAberta | null>(() => {
    if (modo === "mesa_unica") return abas.find((t) => t.name === "Mesa") ?? abas[0] ?? null;
    return escolhida && abas.some((t) => t.id === escolhida.id) ? escolhida : null;
  }, [modo, abas, escolhida]);

  return {
    sessao,
    resumo,
    modo,
    abas,
    comandaAtiva,
    semConexao,
    naoPareado,
    /** Pedido pausado nesta mesa (JM-186). Sem resumo ainda, não bloqueia: o banco decide. */
    contingencia: resumo ? !resumo.ordering_enabled : false,
    tocar,
    garantirMesa,
    atualizar,
    criarComanda,
    escolherComanda: setEscolhida,
    zerarComanda,
    esquecerMesa,
  };
}

export type Mesa = ReturnType<typeof useMesa>;
