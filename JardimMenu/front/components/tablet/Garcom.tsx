"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getMenuSource } from "@/lib/menu-source";
import { REFORCO_DEPOIS_DE_MS, type ChamadoDeGarcom } from "@/lib/mesa";
import { registrarEvento } from "@/lib/pixel";
import { PedidoRecusado } from "@/lib/sacola";

/**
 * O chamado de garçom, o caminho garantido do tablet (JM-187).
 *
 * - Não passa pelo caminho do pedido: tem a sua function, e funciona com o pedido
 *   desligado, a mesa em contingência, a abertura fechada e o tablet desativado.
 * - O botão existe em toda tela, inclusive no modal do produto, na sacola, na revisão, na
 *   conta, na tela de erro e na de sem conexão. Cada tela põe o `BotaoGarcom` no próprio
 *   cabeçalho, que não rola; o estado é um só, deste provedor.
 * - Dois toques em 60 s dão um chamado só, e isso é decidido no banco (JM-038).
 * - Sem atendimento em 3 min, o botão vira "Reforçar chamado" (JM-040). O banco confere
 *   os 3 min de novo.
 * - Atendido na tela da equipe, o polling traz "garçom a caminho" em até 10 s (JM-039).
 * - Sem rede, ou com o chamado recusado, a tela manda chamar com a voz e mostra o número
 *   da mesa em fonte grande (JM-185).
 */

export type EstadoDoChamado = "livre" | "chamado" | "reforcavel" | "reforcado" | "a_caminho";

interface Aviso {
  id: number;
  texto: string;
  /** Mostra o número da mesa grande, para chamar com a voz. */
  destaque: boolean;
}

interface ContextoDoGarcom {
  estado: EstadoDoChamado;
  ocupado: boolean;
  acionar: () => void;
}

const Contexto = createContext<ContextoDoGarcom | null>(null);

/** Um chamado local recém-criado vale mais que um polling que saiu antes dele. */
const JANELA_DO_LOCAL_MS = 15_000;

export function GarcomProvider({
  mesa,
  chamadoDoResumo,
  children,
}: {
  mesa: number | null;
  /** O chamado que o polling trouxe. `undefined` enquanto não há resumo. */
  chamadoDoResumo: ChamadoDeGarcom | null | undefined;
  children: ReactNode;
}) {
  const [chamado, setChamado] = useState<ChamadoDeGarcom | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  /** Quando este tablet viu cada chamado pela primeira vez, no relógio dele. */
  const vistoEm = useRef(new Map<string, number>());
  const atendimentoAvisado = useRef(new Set<string>());

  const avisar = useCallback((texto: string, destaque = false) => {
    setAviso({ id: Date.now(), texto, destaque });
  }, []);

  const registrar = useCallback((c: ChamadoDeGarcom) => {
    const jaVisto = vistoEm.current.has(c.call_id);
    if (!jaVisto) vistoEm.current.set(c.call_id, Date.now());
    // Chamado que já chegou atendido (tela recarregada) não gera aviso.
    if (c.acknowledged_at && !jaVisto) atendimentoAvisado.current.add(c.call_id);
  }, []);

  // O polling é a fonte do estado; o chamado local recente sobrevive a um resumo atrasado.
  useEffect(() => {
    if (chamadoDoResumo === undefined) return;
    if (chamadoDoResumo) registrar(chamadoDoResumo);
    setChamado((atual) => {
      if (chamadoDoResumo) return chamadoDoResumo;
      const visto = atual ? vistoEm.current.get(atual.call_id) : undefined;
      return atual && visto !== undefined && Date.now() - visto < JANELA_DO_LOCAL_MS ? atual : null;
    });
  }, [chamadoDoResumo, registrar]);

  // "Garçom a caminho" (JM-039), uma vez por chamado.
  useEffect(() => {
    if (!chamado?.acknowledged_at || atendimentoAvisado.current.has(chamado.call_id)) return;
    atendimentoAvisado.current.add(chamado.call_id);
    avisar("O garçom está a caminho.");
  }, [chamado, avisar]);

  // Relógio do reforço: só corre com chamado aberto.
  useEffect(() => {
    if (!chamado || chamado.acknowledged_at || chamado.closed_at) return;
    const relogio = setInterval(() => setAgora(Date.now()), 5_000);
    return () => clearInterval(relogio);
  }, [chamado]);

  // O aviso some sozinho; o de mesa em destaque fica mais tempo.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.destaque ? 15_000 : 6_000);
    return () => clearTimeout(t);
  }, [aviso]);

  const estado: EstadoDoChamado = useMemo(() => {
    if (!chamado) return "livre";
    if (chamado.acknowledged_at) return "a_caminho";
    if (chamado.closed_at) return "livre";
    if (chamado.reinforced_at) return "reforcado";
    const visto = vistoEm.current.get(chamado.call_id) ?? agora;
    return agora - visto >= REFORCO_DEPOIS_DE_MS ? "reforcavel" : "chamado";
  }, [chamado, agora]);

  const falhou = useCallback(
    (e: unknown) => {
      if (e instanceof PedidoRecusado && e.codigo === "REDE") {
        avisar("Sem conexão. Chame a equipe com a voz ou acene, dizendo o número da mesa.", true);
      } else if (e instanceof PedidoRecusado && (e.codigo === "JMW01" || e.codigo === "JM409")) {
        avisar(e.message);
      } else {
        avisar("O chamado não saiu pelo tablet. Acene para a equipe, dizendo o número da mesa.", true);
      }
    },
    [avisar],
  );

  const acionar = useCallback(() => {
    if (ocupado) return;
    setOcupado(true);
    setAgora(Date.now());
    const fonte = getMenuSource();

    const tarefa =
      estado === "reforcavel" && chamado
        ? fonte.reforcarChamado(chamado.call_id).then((r) => {
            registrar(r);
            setChamado(r);
            avisar("Chamado reforçado. A equipe foi avisada de novo.");
          })
        : fonte.chamarGarcom().then((r) => {
            registrar(r);
            setChamado(r);
            if (!r.repeated) {
              registrarEvento("waiter_call");
              avisar("Chamado recebido pela equipe. O garçom já vem.");
            } else {
              avisar(r.acknowledged_at ? "O garçom está a caminho." : "A equipe já recebeu o chamado.");
            }
          });

    tarefa.catch(falhou).finally(() => setOcupado(false));
  }, [ocupado, estado, chamado, registrar, avisar, falhou]);

  const valor = useMemo(() => ({ estado, ocupado, acionar }), [estado, ocupado, acionar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {aviso ? <AvisoDoChamado key={aviso.id} aviso={aviso} mesa={mesa} onFechar={() => setAviso(null)} /> : null}
    </Contexto.Provider>
  );
}

function AvisoDoChamado({ aviso, mesa, onFechar }: { aviso: Aviso; mesa: number | null; onFechar: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center p-3 sm:p-4">
      <div
        role={aviso.destaque ? "alert" : "status"}
        className={`rounded-card shadow-float pointer-events-auto flex w-full max-w-md items-start gap-3 p-4 ${
          aviso.destaque ? "bg-danger text-white" : "bg-ink text-white"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{aviso.texto}</p>
          {aviso.destaque && mesa !== null ? (
            <p className="mt-2 text-5xl leading-none font-bold tabular-nums">Mesa {mesa}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar o aviso"
          className="jm-touch jm-focus flex shrink-0 items-center justify-center rounded-full px-3 text-lg hover:bg-white/10"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

const ROTULOS: Record<EstadoDoChamado, string> = {
  livre: "Chamar garçom",
  chamado: "Garçom chamado",
  reforcavel: "Reforçar chamado",
  reforcado: "Chamado reforçado",
  a_caminho: "Garçom a caminho",
};

function IconeSino() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

/**
 * O botão de chamar o garçom. `tom` diz sobre qual fundo ele está: `primaria` na barra
 * verde da loja, `claro` nos cabeçalhos brancos. `compacto` esconde o texto abaixo de
 * 480px, e `soIcone` sempre (coluna minimizada); nos dois, o rótulo segue acessível.
 */
export function BotaoGarcom({
  tom = "claro",
  grande = false,
  compacto = false,
  soIcone = false,
  className = "",
}: {
  tom?: "claro" | "primaria";
  grande?: boolean;
  compacto?: boolean;
  soIcone?: boolean;
  className?: string;
}) {
  const ctx = useContext(Contexto);
  if (!ctx) return null;
  const { estado, ocupado, acionar } = ctx;

  const cor =
    estado === "reforcavel"
      ? "bg-accent text-white"
      : estado === "livre"
        ? tom === "primaria"
          ? "text-ink bg-white"
          : "bg-primary text-white"
        : tom === "primaria"
          ? "bg-white/15 text-white ring-2 ring-white/60"
          : "bg-canvas text-ink ring-primary ring-2";

  return (
    <button
      type="button"
      onClick={acionar}
      disabled={ocupado}
      aria-label={ROTULOS[estado]}
      data-garcom={estado}
      className={`jm-touch jm-focus inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold disabled:opacity-70 ${
        grande ? "px-8 text-xl" : soIcone ? "px-3" : "px-4 text-base"
      } ${cor} ${className}`}
    >
      <IconeSino />
      <span className={soIcone ? "sr-only" : compacto ? "max-[479px]:sr-only" : ""}>{ocupado ? "Chamando…" : ROTULOS[estado]}</span>
    </button>
  );
}
