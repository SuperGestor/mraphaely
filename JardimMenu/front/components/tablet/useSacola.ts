"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { MenuProduct } from "@/lib/types";
import { getMenuSource } from "@/lib/menu-source";
import {
  mesmaEscolha,
  QUANTIDADE_MAXIMA,
  somarEmCentavos,
  type EscolhaDoModal,
  type ItemDaSacola,
} from "@/lib/sacola";

/**
 * Estado da sacola da tela do tablet, só em memória (JM-183).
 *
 * Toda mudança de quantidade pede o total de novo ao servidor (JM-031). Cada linha tem uma
 * versão do pedido de total em curso: resposta atrasada de um toque anterior é descartada,
 * para o total nunca voltar a um valor velho.
 */
export function useSacola() {
  const [itens, setItens] = useState<ItemDaSacola[]>([]);
  const versoes = useRef(new Map<string, number>());

  const recalcular = useCallback(
    (item: Pick<ItemDaSacola, "chave" | "produto" | "option_ids" | "notes">, quantity: number) => {
      const versao = (versoes.current.get(item.chave) ?? 0) + 1;
      versoes.current.set(item.chave, versao);
      const atualizar = (mudanca: Partial<ItemDaSacola>) =>
        setItens((atual) => atual.map((i) => (i.chave === item.chave ? { ...i, ...mudanca } : i)));

      atualizar({ quantity, total: null, erro: false });
      getMenuSource()
        .getItemTotal({ product_id: item.produto.id, quantity, option_ids: item.option_ids, notes: item.notes })
        .then((total) => {
          if (versoes.current.get(item.chave) === versao) atualizar({ total, erro: false });
        })
        .catch(() => {
          if (versoes.current.get(item.chave) === versao) atualizar({ total: null, erro: true });
        });
    },
    [],
  );

  /** Escolha igual a uma linha existente soma na linha, até o limite; senão, linha nova. */
  function adicionar(produto: MenuProduct, escolha: EscolhaDoModal) {
    const igual = itens.find((i) => i.produto.id === produto.id && mesmaEscolha(i, escolha));
    if (igual) {
      recalcular(igual, Math.min(QUANTIDADE_MAXIMA, igual.quantity + escolha.quantity));
      return;
    }
    const nova: ItemDaSacola = {
      chave: crypto.randomUUID(),
      produto,
      quantity: escolha.quantity,
      option_ids: escolha.option_ids,
      notes: escolha.notes,
      total: escolha.total,
      erro: false,
    };
    setItens((atual) => [...atual, nova]);
  }

  /** Edição pelo modal: a linha troca de escolha e recebe o total que o modal já buscou. */
  function substituir(chave: string, escolha: EscolhaDoModal) {
    versoes.current.set(chave, (versoes.current.get(chave) ?? 0) + 1);
    setItens((atual) =>
      atual.map((i) =>
        i.chave === chave
          ? { ...i, quantity: escolha.quantity, option_ids: escolha.option_ids, notes: escolha.notes, total: escolha.total, erro: false }
          : i,
      ),
    );
  }

  function mudarQuantidade(chave: string, quantidade: number) {
    const item = itens.find((i) => i.chave === chave);
    if (!item) return;
    const limitada = Math.max(1, Math.min(QUANTIDADE_MAXIMA, quantidade));
    if (limitada !== item.quantity) recalcular(item, limitada);
  }

  function remover(chave: string) {
    versoes.current.delete(chave);
    setItens((atual) => atual.filter((i) => i.chave !== chave));
  }

  function esvaziar() {
    versoes.current.clear();
    setItens([]);
  }

  const quantidade = useMemo(() => itens.reduce((soma, i) => soma + i.quantity, 0), [itens]);
  const total = useMemo(() => somarEmCentavos(itens), [itens]);

  return { itens, quantidade, total, adicionar, substituir, mudarQuantidade, remover, esvaziar };
}
