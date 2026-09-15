"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/money";
import { nomesDasOpcoes, QUANTIDADE_MAXIMA, rotuloDeItens, type ItemDaSacola } from "@/lib/sacola";

/**
 * Sacola aberta: ver, mudar quantidade, editar, remover e esvaziar.
 *
 * Remover e esvaziar pedem confirmação na própria linha, porque o toque errado num tablet
 * de mesa é comum e desfazer não existe. O total de cada linha e o da sacola vêm do
 * servidor (JM-031), com o aviso de que o valor final é o do caixa (JM-011, D29).
 *
 * Painel lateral de 440px; no celular, ocupa a largura inteira.
 */
export function CartDrawer({
  itens,
  quantidade,
  total,
  onMudarQuantidade,
  onEditar,
  onRemover,
  onEsvaziar,
  onFinalizar,
  onFechar,
}: {
  itens: ItemDaSacola[];
  quantidade: number;
  total: number | null;
  onMudarQuantidade: (chave: string, quantidade: number) => void;
  onEditar: (chave: string) => void;
  onRemover: (chave: string) => void;
  onEsvaziar: () => void;
  onFinalizar: () => void;
  onFechar: () => void;
}) {
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [esvaziando, setEsvaziando] = useState(false);
  const fechar = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    fechar.current?.focus();
  }, []);

  useEffect(() => {
    const fechaComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", fechaComEsc);
    return () => window.removeEventListener("keydown", fechaComEsc);
  }, [onFechar]);

  const semPreco = itens.some((i) => i.erro);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sacola-titulo"
      onClick={onFechar}
    >
      <div
        className="bg-surface shadow-float flex h-full w-full flex-col sm:w-[440px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-line flex items-center justify-between gap-4 border-b px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <h2 id="sacola-titulo" className="text-2xl font-bold">
              Sua sacola
            </h2>
            <p className="text-muted text-sm">{quantidade === 0 ? "Nenhum item" : rotuloDeItens(quantidade)}</p>
          </div>
          <button
            ref={fechar}
            type="button"
            onClick={onFechar}
            aria-label="Fechar a sacola"
            className="jm-touch jm-focus bg-canvas flex items-center justify-center rounded-full px-4 text-xl"
          >
            ✕
          </button>
        </header>

        {itens.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-xl font-semibold">Sua sacola está vazia</p>
            <p className="text-muted text-base">Adicione itens do cardápio.</p>
            <button
              type="button"
              onClick={onFechar}
              className="jm-touch jm-focus bg-primary mt-4 rounded-full px-6 text-base font-semibold text-white"
            >
              Ver o cardápio
            </button>
          </div>
        ) : (
          <>
            <ul className="flex-1 overflow-y-auto px-4 sm:px-6">
              {itens.map((item) => {
                const opcoes = nomesDasOpcoes(item);
                return (
                  <li key={item.chave} className="border-line border-b py-4 last:border-b-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base leading-tight font-semibold">{item.produto.name}</p>
                        {opcoes.length > 0 ? <p className="text-muted mt-1 text-sm">{opcoes.join(" · ")}</p> : null}
                        {item.notes ? <p className="text-muted mt-1 text-sm italic">“{item.notes}”</p> : null}
                      </div>
                      <p className="text-base font-bold whitespace-nowrap tabular-nums">
                        {item.total ? money(item.total.line_total) : item.erro ? "Sem preço" : "…"}
                      </p>
                    </div>

                    {removendo === item.chave ? (
                      <div
                        className="rounded-input bg-canvas mt-3 flex flex-wrap items-center justify-between gap-3 p-3"
                        role="alert"
                      >
                        <span className="text-base font-semibold">Remover este item?</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setRemovendo(null)}
                            className="jm-touch jm-focus bg-surface border-line rounded-full border-2 px-4 text-sm font-semibold"
                          >
                            Não
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onRemover(item.chave);
                              setRemovendo(null);
                            }}
                            className="jm-touch jm-focus bg-ink rounded-full px-4 text-sm font-semibold text-white"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="bg-surface border-line flex items-center rounded-full border-2">
                          <button
                            type="button"
                            onClick={() => onMudarQuantidade(item.chave, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            aria-label={`Menos um: ${item.produto.name}`}
                            className="jm-touch jm-focus rounded-full px-4 text-xl font-bold disabled:opacity-40"
                          >
                            −
                          </button>
                          <span className="w-8 text-center text-base font-bold tabular-nums" aria-live="polite">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => onMudarQuantidade(item.chave, item.quantity + 1)}
                            disabled={item.quantity >= QUANTIDADE_MAXIMA}
                            aria-label={`Mais um: ${item.produto.name}`}
                            className="jm-touch jm-focus rounded-full px-4 text-xl font-bold disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onEditar(item.chave)}
                            className="jm-touch jm-focus bg-canvas rounded-full px-4 text-sm font-semibold"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemovendo(item.chave)}
                            className="jm-touch jm-focus bg-canvas rounded-full px-4 text-sm font-semibold"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <footer className="border-line bg-canvas border-t px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-lg font-semibold">Total</span>
                <span className="text-2xl font-bold tabular-nums">
                  {total !== null ? money(total) : semPreco ? "Sem preço" : "Calculando…"}
                </span>
              </div>
              <p className="text-muted mt-1 text-sm">Valor final confirmado no caixa.</p>

              {esvaziando ? (
                <div
                  className="rounded-input bg-surface mt-4 flex flex-wrap items-center justify-between gap-3 p-3"
                  role="alert"
                >
                  <span className="text-base font-semibold">Tirar todos os itens?</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEsvaziando(false)}
                      className="jm-touch jm-focus bg-canvas border-line rounded-full border-2 px-4 text-sm font-semibold"
                    >
                      Não
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onEsvaziar();
                        setEsvaziando(false);
                      }}
                      className="jm-touch jm-focus bg-ink rounded-full px-4 text-sm font-semibold text-white"
                    >
                      Esvaziar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setEsvaziando(true)}
                    className="jm-touch jm-focus bg-surface border-line shrink-0 rounded-full border-2 px-5 text-base font-semibold"
                  >
                    Esvaziar
                  </button>
                  <button
                    type="button"
                    onClick={onFinalizar}
                    disabled={total === null}
                    className="jm-touch jm-focus bg-primary min-w-0 flex-1 rounded-full px-4 text-base font-bold text-white disabled:opacity-45 sm:px-6 sm:text-lg"
                  >
                    Finalizar pedido
                  </button>
                </div>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
