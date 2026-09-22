"use client";

import { useEffect, useRef, useState } from "react";
import type { ModoDeEnvio } from "@/lib/menu-source";
import { money } from "@/lib/money";
import { nomesDasOpcoes, rotuloDeItens, type ItemDaSacola } from "@/lib/sacola";
import { BotaoGarcom } from "./Garcom";
import { ChipDaComanda } from "./Comanda";

/** Limpeza depois do envio: a tela volta ao cardápio em 15 s (JM-183). */
const SEGUNDOS_ATE_LIMPAR = 15;

/**
 * "Confere seu pedido?": o último passo antes do envio. O cliente vê tudo o que vai sair,
 * volta para alterar ou confirma.
 *
 * A confirmação trava quando o pedido não pode sair, e diz por quê: sem rede (JM-185),
 * loja fechada (JM-005), mesa em contingência (JM-186) ou comanda por escolher (JM-200).
 * Nunca há confirmação falsa: o que vale é a resposta do banco.
 *
 * No celular abre como folha que sobe do rodapé; em telas maiores, como janela.
 */
export function OrderReview({
  itens,
  total,
  mesa,
  envio,
  avisoFechado,
  offline,
  contingencia,
  semComanda,
  enviando,
  erro,
  onVoltar,
  onConfirmar,
}: {
  itens: ItemDaSacola[];
  total: number | null;
  mesa: number | null;
  envio: ModoDeEnvio;
  avisoFechado: string | null;
  offline: boolean;
  contingencia: boolean;
  semComanda: boolean;
  enviando: boolean;
  erro: string | null;
  onVoltar: () => void;
  onConfirmar: () => void;
}) {
  const titulo = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  useEffect(() => {
    const voltaComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enviando) onVoltar();
    };
    window.addEventListener("keydown", voltaComEsc);
    return () => window.removeEventListener("keydown", voltaComEsc);
  }, [onVoltar, enviando]);

  const quantidade = itens.reduce((soma, i) => soma + i.quantity, 0);
  const bloqueios = [
    offline ? "Sem conexão. Nenhum pedido sai sem rede: chame o garçom." : null,
    avisoFechado ? `${avisoFechado} O pedido fica disponível no horário da casa.` : null,
    contingencia ? "O pedido por esta mesa está pausado agora. Peça ao garçom." : null,
    semComanda ? "Escolha a comanda deste pedido." : null,
    total === null ? "Um item está sem preço. Volte e ajuste a sacola." : null,
  ].filter((b): b is string => b !== null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revisao-titulo"
    >
      <div className="rounded-t-modal sm:rounded-modal bg-surface shadow-float flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden sm:max-h-full">
        <header className="border-line border-b p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="revisao-titulo" ref={titulo} tabIndex={-1} className="text-2xl font-bold outline-none">
              Confere seu pedido?
            </h2>
            {envio === "demonstracao" ? <SeloDemonstracao /> : null}
            <BotaoGarcom compacto className="ml-auto" />
          </div>
          <ChipDaComanda className="mt-2" />
          <p className="text-muted mt-1 text-base">
            {mesa !== null ? `Mesa ${mesa} · ` : ""}
            {rotuloDeItens(quantidade)}
          </p>
        </header>

        <ul className="flex-1 overflow-y-auto px-4 sm:px-6">
          {itens.map((item) => {
            const opcoes = nomesDasOpcoes(item);
            return (
              <li key={item.chave} className="border-line flex items-start justify-between gap-4 border-b py-4 last:border-b-0">
                <div className="flex min-w-0 gap-3">
                  <span className="text-base font-bold tabular-nums">{item.quantity}×</span>
                  <div className="min-w-0">
                    <p className="text-base leading-tight font-semibold">{item.produto.name}</p>
                    {opcoes.length > 0 ? <p className="text-muted mt-1 text-sm">{opcoes.join(" · ")}</p> : null}
                    {item.notes ? <p className="text-muted mt-1 text-sm italic">“{item.notes}”</p> : null}
                  </div>
                </div>
                <p className="text-base font-bold whitespace-nowrap tabular-nums">
                  {item.total ? money(item.total.line_total) : "—"}
                </p>
              </li>
            );
          })}
        </ul>

        <footer className="border-line bg-canvas border-t p-4 sm:p-6">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-lg font-semibold">Total</span>
            <span className="text-2xl font-bold tabular-nums">{total !== null ? money(total) : "—"}</span>
          </div>
          <p className="text-muted mt-1 text-sm">Valor final confirmado no caixa.</p>
          {envio === "demonstracao" ? (
            <p className="text-muted mt-1 text-sm">Cardápio de exemplo: confirmar não envia nada para a cozinha.</p>
          ) : null}

          {bloqueios.map((b) => (
            <p key={b} className="mt-3 text-base font-semibold" role="status">
              {b}
            </p>
          ))}
          {erro ? (
            <p className="bg-surface border-line rounded-input mt-3 border-2 p-3 text-base font-semibold" role="alert">
              {erro}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onVoltar}
              disabled={enviando}
              className="jm-touch jm-focus bg-surface border-line rounded-full border-2 px-6 text-base font-semibold disabled:opacity-45"
            >
              Voltar e alterar
            </button>
            <button
              type="button"
              onClick={onConfirmar}
              disabled={bloqueios.length > 0 || enviando}
              className="jm-touch jm-focus bg-primary rounded-full px-6 text-lg font-bold text-white disabled:opacity-45 sm:flex-1"
            >
              {enviando ? "Enviando…" : "Confirmar pedido"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Pedido que saiu. Volta sozinho ao cardápio em 15 s, ou antes, pelo botão, e a volta é a
 * limpeza entre clientes (JM-183). Sem status de preparo na primeira versão (D23): a tela
 * diz só que o pedido foi enviado.
 */
export function OrderSent({
  numero,
  mesa,
  comanda,
  demonstracao,
  onFechar,
}: {
  numero: number;
  mesa: number | null;
  /** Nome da comanda, no modo nomeada. */
  comanda: string | null;
  demonstracao: boolean;
  onFechar: () => void;
}) {
  const [restante, setRestante] = useState(SEGUNDOS_ATE_LIMPAR);
  const botao = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    botao.current?.focus();
    const relogio = setInterval(() => setRestante((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(relogio);
  }, []);

  useEffect(() => {
    if (restante === 0) onFechar();
  }, [restante, onFechar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enviado-titulo"
    >
      <div className="rounded-modal bg-surface shadow-float w-full max-w-lg p-6 text-center sm:p-10">
        <div
          className="bg-primary mx-auto flex size-16 items-center justify-center rounded-full text-3xl font-bold text-white sm:size-20 sm:text-4xl"
          aria-hidden="true"
        >
          ✓
        </div>
        {demonstracao ? (
          <div className="mt-6">
            <SeloDemonstracao />
          </div>
        ) : null}
        <h2 id="enviado-titulo" className="mt-4 text-2xl font-bold sm:text-3xl">
          Pedido nº {numero} enviado
        </h2>
        {mesa !== null || comanda ? (
          <p className="text-muted mt-2 text-lg">
            {[mesa !== null ? `Mesa ${mesa}` : null, comanda ? `comanda de ${comanda}` : null].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {demonstracao ? (
          <p className="mt-4 text-base">Nada foi enviado à cozinha: este é o cardápio de exemplo.</p>
        ) : null}
        <p className="text-muted mt-6 text-sm">A tela volta ao cardápio em {restante} s.</p>
        <div className="mt-4 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            ref={botao}
            type="button"
            onClick={onFechar}
            className="jm-touch jm-focus bg-primary w-full rounded-full px-8 text-lg font-bold text-white sm:w-auto"
          >
            Voltar ao cardápio
          </button>
          <BotaoGarcom />
        </div>
      </div>
    </div>
  );
}

function SeloDemonstracao() {
  return (
    <span className="bg-accent inline-block rounded-full px-3 py-1 text-xs font-bold tracking-wide text-white uppercase">
      Demonstração
    </span>
  );
}
