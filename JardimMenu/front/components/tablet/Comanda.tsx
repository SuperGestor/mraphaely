"use client";

import { createContext, useContext, useEffect, useRef, useState, type FormEvent } from "react";
import type { ComandaAberta, ModoDeComanda } from "@/lib/mesa";
import { PedidoRecusado } from "@/lib/sacola";
import { BotaoGarcom } from "./Garcom";

/**
 * Comandas no tablet (Módulo N, JM-200 e JM-201).
 *
 * - Em `mesa_unica`, nada aqui aparece: o cliente nunca vê a palavra comanda, e o fluxo
 *   não ganha nenhum toque (JM-200).
 * - Em `nomeada`, a comanda ativa fica visível em toda tela ("Pedindo como: Maria"), e
 *   trocar leva 1 toque (JM-201, R25).
 */

interface ContextoDaComanda {
  modo: ModoDeComanda;
  ativa: ComandaAberta | null;
  trocar: () => void;
}

const Contexto = createContext<ContextoDaComanda | null>(null);
export const ComandaProvider = Contexto.Provider;

/** Faixa de largura inteira, abaixo do cabeçalho da tela do cardápio. */
export function FaixaDaComanda() {
  const ctx = useContext(Contexto);
  if (!ctx || ctx.modo !== "nomeada") return null;
  return (
    <div className="border-line bg-canvas flex items-center gap-3 border-b px-4 py-2 sm:px-6">
      <p className="min-w-0 flex-1 truncate text-base">
        {ctx.ativa ? (
          <>
            Pedindo como: <strong className="font-bold">{ctx.ativa.name}</strong>
          </>
        ) : (
          "Nenhuma comanda escolhida"
        )}
      </p>
      <button
        type="button"
        onClick={ctx.trocar}
        className="jm-touch jm-focus bg-surface border-line shrink-0 rounded-full border-2 px-4 text-base font-semibold"
      >
        {ctx.ativa ? "Trocar" : "Escolher comanda"}
      </button>
    </div>
  );
}

/** Versão curta, para o cabeçalho das janelas (modal, sacola, revisão). */
export function ChipDaComanda({ className = "" }: { className?: string }) {
  const ctx = useContext(Contexto);
  if (!ctx || ctx.modo !== "nomeada") return null;
  return (
    <button
      type="button"
      onClick={ctx.trocar}
      className={`jm-touch jm-focus bg-canvas inline-flex max-w-full items-center gap-1 rounded-full px-4 text-sm font-semibold ${className}`}
    >
      <span className="truncate">{ctx.ativa ? `Pedindo como: ${ctx.ativa.name}` : "Escolher comanda"}</span>
      <span aria-hidden="true">▾</span>
    </button>
  );
}

export const NOME_MAXIMO = 24;

/**
 * Escolher ou criar a comanda. Aparece no primeiro pedido da abertura, no modo `nomeada`
 * (JM-200), e sempre que o cliente toca em "Trocar". Só as comandas abertas aparecem.
 */
export function SeletorDeComanda({
  abas,
  ativa,
  paraEnviar,
  onEscolher,
  onCriar,
  onFechar,
}: {
  abas: ComandaAberta[];
  ativa: ComandaAberta | null;
  /** Aberto pelo "Finalizar": o título pergunta de quem é o pedido. */
  paraEnviar: boolean;
  onEscolher: (c: ComandaAberta) => void;
  onCriar: (nome: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const titulo = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  useEffect(() => {
    const fechaComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !criando) onFechar();
    };
    window.addEventListener("keydown", fechaComEsc);
    return () => window.removeEventListener("keydown", fechaComEsc);
  }, [onFechar, criando]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (limpo.length === 0) {
      setErro("Escreva um nome para a comanda.");
      return;
    }
    setCriando(true);
    setErro(null);
    try {
      await onCriar(limpo);
    } catch (falha) {
      setErro(falha instanceof PedidoRecusado ? falha.message : "Não deu para abrir a comanda. Tente de novo.");
      setCriando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="comanda-titulo"
      onClick={criando ? undefined : onFechar}
    >
      <div
        className="rounded-t-modal sm:rounded-modal bg-surface shadow-float flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-line flex items-start gap-3 border-b p-4 sm:p-6">
          <div className="min-w-0 flex-1">
            <h2 id="comanda-titulo" ref={titulo} tabIndex={-1} className="text-2xl font-bold outline-none">
              {paraEnviar ? "De quem é este pedido?" : "Trocar de comanda"}
            </h2>
            <p className="text-muted mt-1 text-base">Cada pessoa da mesa pode ter a sua comanda.</p>
          </div>
          <BotaoGarcom compacto />
          <button
            type="button"
            onClick={onFechar}
            disabled={criando}
            aria-label="Fechar"
            className="jm-touch jm-focus bg-canvas flex shrink-0 items-center justify-center rounded-full px-4 text-xl"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {abas.length > 0 ? (
            <>
              <p className="text-muted mb-2 text-sm font-semibold tracking-wide uppercase">Comandas abertas</p>
              <ul className="mb-6 grid gap-2">
                {abas.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onEscolher(c)}
                      aria-current={ativa?.id === c.id}
                      className={`jm-touch jm-focus rounded-input flex w-full items-center justify-between gap-3 border-2 px-4 text-left text-lg font-semibold ${
                        ativa?.id === c.id ? "border-primary bg-canvas" : "border-line bg-surface"
                      }`}
                    >
                      <span className="truncate">{c.name}</span>
                      {ativa?.id === c.id ? <span className="text-muted text-sm">atual</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <form onSubmit={criar} className="grid gap-2">
            <label htmlFor="nome-comanda" className="text-base font-semibold">
              {abas.length > 0 ? "Ou abra uma nova" : "Abra a sua comanda"}
            </label>
            <input
              id="nome-comanda"
              value={nome}
              onChange={(e) => setNome(e.target.value.slice(0, NOME_MAXIMO))}
              maxLength={NOME_MAXIMO}
              autoComplete="off"
              placeholder="Seu nome ou apelido"
              className="rounded-input border-line bg-canvas jm-touch jm-focus w-full border-2 px-4 text-lg"
            />
            <p className="text-muted text-sm">Até {NOME_MAXIMO} letras. Aparece só para a equipe e nesta mesa.</p>
            {erro ? (
              <p className="text-base font-semibold" role="alert">
                {erro}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={criando}
              className="jm-touch jm-focus bg-primary mt-2 rounded-full px-6 text-lg font-bold text-white disabled:opacity-45"
            >
              {criando ? "Abrindo…" : "Abrir comanda"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
