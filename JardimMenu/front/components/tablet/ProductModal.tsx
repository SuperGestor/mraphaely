"use client";

import { useEffect, useMemo, useState } from "react";
import type { ItemTotal, MenuProduct, OptionGroup, Uuid } from "@/lib/types";
import { getMenuSource } from "@/lib/menu-source";
import { money, moneyDelta } from "@/lib/money";
import { registrarEvento } from "@/lib/pixel";
import { urlDaFoto } from "@/lib/foto";
import type { EscolhaDoModal } from "@/lib/sacola";
import { BotaoGarcom } from "./Garcom";
import { ChipDaComanda } from "./Comanda";

/**
 * Modal de personalização (JM-003). Duas regras que vêm do documento:
 *
 * 1. Grupo obrigatório trava o botão até a escolha, e a tela diz qual grupo falta.
 * 2. O total **não** é somado aqui: ele vem do servidor (regra 6, JM-031). Na Fase A o
 *    servidor é o dublê da camada de dados; na Fase B é a function do banco.
 *
 * O botão entrega a escolha à sacola da tela, junto com o total que o servidor calculou.
 * Com `inicial`, o modal edita uma linha da sacola em vez de adicionar outra.
 *
 * No celular ele abre como folha que sobe do rodapé, na largura inteira; em telas maiores,
 * como janela.
 */
export function ProductModal({
  produto,
  inicial,
  onConfirmar,
  onFechar,
}: {
  produto: MenuProduct;
  inicial?: { quantity: number; option_ids: Uuid[]; notes: string | null };
  onConfirmar: (escolha: EscolhaDoModal) => void;
  onFechar: () => void;
}) {
  const [escolhas, setEscolhas] = useState<Record<string, string[]>>(() =>
    inicial
      ? Object.fromEntries(
          produto.option_groups.map((g) => [
            g.id,
            g.options.filter((o) => inicial.option_ids.includes(o.id)).map((o) => o.id),
          ]),
        )
      : {},
  );
  const [quantidade, setQuantidade] = useState(inicial?.quantity ?? 1);
  const [observacao, setObservacao] = useState(inicial?.notes ?? "");
  const [total, setTotal] = useState<ItemTotal | null>(null);
  const [calculando, setCalculando] = useState(true);
  const [erroTotal, setErroTotal] = useState(false);

  const selecionados = useMemo(() => Object.values(escolhas).flat(), [escolhas]);
  const foto = urlDaFoto(produto.photo_path, "modal");

  const faltando = useMemo(
    () =>
      produto.option_groups.filter(
        (g) => (escolhas[g.id]?.length ?? 0) < g.min_select,
      ),
    [produto.option_groups, escolhas],
  );

  // Tempo de vitrine do produto (JM-060): medido do abrir ao fechar do modal.
  useEffect(() => {
    const inicio = Date.now();
    return () => {
      registrarEvento("product_view_time", {
        product_id: produto.id,
        value_ms: Date.now() - inicio,
      });
    };
  }, [produto.id]);

  // O preço vem do servidor a cada mudança de escolha ou de quantidade.
  useEffect(() => {
    let ativo = true;
    setCalculando(true);
    setErroTotal(false);
    getMenuSource()
      .getItemTotal({
        product_id: produto.id,
        quantity: quantidade,
        option_ids: selecionados,
        notes: null, // observação não muda preço
      })
      .then((t) => {
        if (ativo) setTotal(t);
      })
      .catch(() => {
        if (ativo) setErroTotal(true);
      })
      .finally(() => {
        if (ativo) setCalculando(false);
      });
    return () => {
      ativo = false;
    };
    // observacao não entra: não muda preço.
  }, [produto.id, quantidade, selecionados]);

  useEffect(() => {
    const fechaComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", fechaComEsc);
    return () => window.removeEventListener("keydown", fechaComEsc);
  }, [onFechar]);

  function alternar(grupo: OptionGroup, optionId: string) {
    setEscolhas((atual) => {
      const atuais = atual[grupo.id] ?? [];
      if (grupo.max_select === 1) {
        return { ...atual, [grupo.id]: atuais[0] === optionId ? [] : [optionId] };
      }
      if (atuais.includes(optionId)) {
        return { ...atual, [grupo.id]: atuais.filter((o) => o !== optionId) };
      }
      if (atuais.length >= grupo.max_select) return atual;
      return { ...atual, [grupo.id]: [...atuais, optionId] };
    });
  }

  const travado = faltando.length > 0 || calculando || erroTotal;

  function confirmar() {
    // `total` só vale para a escolha atual quando nada está calculando: `travado` garante.
    if (travado || !total) return;
    onConfirmar({
      quantity: quantidade,
      option_ids: selecionados,
      notes: observacao.trim() || null,
      total,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:p-6 min-[1200px]:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={produto.name}
      onClick={onFechar}
    >
      <div
        className="rounded-t-modal sm:rounded-modal bg-surface shadow-float flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden sm:max-h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {foto ? (
          // Em tela baixa (celular deitado) a foto sai, para o botão de adicionar caber.
          <div className="h-40 w-full shrink-0 overflow-hidden sm:h-44 [@media(max-height:560px)]:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- foto já otimizada no upload, na largura do modal */}
            <img src={foto} alt="" decoding="async" className="jm-ken-a h-full w-full object-cover" />
          </div>
        ) : null}

        <header className="border-line flex items-start justify-between gap-4 border-b p-4 sm:p-6">
          <div className="min-w-0">
            <h2 className="text-xl leading-tight font-bold sm:text-2xl">{produto.name}</h2>
            {produto.description ? (
              <p className="text-muted mt-1 text-base">{produto.description}</p>
            ) : null}
            <p className="text-accent mt-2 text-lg font-bold">{money(produto.price)}</p>
            <ChipDaComanda className="mt-2" />
          </div>
          {/* O garçom fica no cabeçalho, que não rola (JM-187). */}
          <div className="flex shrink-0 items-start gap-2">
            <BotaoGarcom compacto />
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar"
              className="jm-touch jm-focus bg-canvas flex shrink-0 items-center justify-center rounded-full px-4 text-xl"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {produto.option_groups.map((grupo) => {
            const atuais = escolhas[grupo.id] ?? [];
            const obrigatorio = grupo.min_select > 0;
            const cheio = atuais.length >= grupo.max_select;

            return (
              <section key={grupo.id} className="mb-7">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-semibold">{grupo.name}</h3>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                      obrigatorio ? "bg-primary text-white" : "bg-canvas text-muted"
                    }`}
                  >
                    {obrigatorio
                      ? grupo.max_select === 1
                        ? "Escolha 1"
                        : `Escolha de ${grupo.min_select} a ${grupo.max_select}`
                      : `Até ${grupo.max_select}`}
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {grupo.options.map((opcao) => {
                    const marcada = atuais.includes(opcao.id);
                    const bloqueada = !opcao.is_available || (cheio && !marcada);
                    const delta = moneyDelta(opcao.price_delta);

                    return (
                      <button
                        key={opcao.id}
                        type="button"
                        role={grupo.max_select === 1 ? "radio" : "checkbox"}
                        aria-checked={marcada}
                        disabled={bloqueada}
                        onClick={() => alternar(grupo, opcao.id)}
                        className={`jm-touch jm-focus rounded-input flex items-center justify-between gap-3 border-2 px-4 py-3 text-left text-base ${
                          marcada ? "border-primary bg-canvas" : "border-line bg-surface"
                        } ${bloqueada ? "opacity-40" : ""}`}
                      >
                        <span className="font-medium">
                          {opcao.name}
                          {!opcao.is_available ? " (esgotado)" : ""}
                        </span>
                        {delta ? <span className="text-accent shrink-0 font-semibold">{delta}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <section className="mb-2">
            <label htmlFor="observacao" className="text-lg font-semibold">
              Observação
            </label>
            <p className="text-muted mt-1 text-sm">
              Não escreva dados pessoais aqui. Máximo de 140 caracteres.
            </p>
            <textarea
              id="observacao"
              value={observacao}
              maxLength={140}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              className="rounded-input border-line bg-canvas jm-focus mt-2 w-full border-2 p-3 text-base"
              placeholder="Sem cebola, por exemplo"
            />
          </section>
        </div>

        <footer className="border-line bg-canvas border-t p-4 sm:p-6">
          {faltando.length > 0 ? (
            <p className="mb-3 text-base font-semibold" role="status">
              Falta escolher: {faltando.map((g) => g.name).join(", ")}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between min-[420px]:gap-6">
            <div className="bg-surface border-line flex items-center self-center rounded-full border-2 min-[420px]:self-auto">
              <button
                type="button"
                onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
                disabled={quantidade === 1}
                aria-label="Menos um"
                className="jm-touch jm-focus rounded-full px-5 text-xl font-bold disabled:opacity-40"
              >
                −
              </button>
              <span className="w-10 text-center text-lg font-bold tabular-nums" aria-live="polite">
                {quantidade}
              </span>
              <button
                type="button"
                onClick={() => setQuantidade((q) => Math.min(20, q + 1))}
                aria-label="Mais um"
                className="jm-touch jm-focus rounded-full px-5 text-xl font-bold"
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={confirmar}
              disabled={travado}
              className="jm-touch jm-focus bg-primary w-full rounded-full px-6 text-base font-bold text-white disabled:opacity-45 min-[420px]:w-auto min-[420px]:flex-1 sm:text-lg"
            >
              {erroTotal
                ? "Preço indisponível"
                : calculando
                  ? "Calculando…"
                  : `${inicial ? "Salvar alterações" : "Adicionar"} · ${money(total?.line_total ?? 0)}`}
            </button>
          </div>

          <p className="text-muted mt-3 text-sm">O total vem do servidor, nunca da tela.</p>
        </footer>
      </div>
    </div>
  );
}
