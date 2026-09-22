"use client";

import { useEffect, useRef } from "react";

/** Limpeza por inatividade entre clientes (JM-183). */
export const INATIVIDADE_MS = 3 * 60_000;

const EVENTOS = ["pointerdown", "keydown", "wheel", "touchmove"] as const;

/**
 * Chama `limpar` depois de 3 min sem toque, **se** alguém tocou desde a última limpeza.
 * Tela parada no estado inicial não é limpa de novo: senão a sessão do pixel seria
 * renovada a cada 3 min sem cliente nenhum, e o painel de inteligência contaria sessões
 * vazias.
 *
 * `pausado` segura a limpeza enquanto um envio está em andamento.
 */
export function useInatividade(limpar: () => void, pausado: boolean) {
  const limparRef = useRef(limpar);
  const pausadoRef = useRef(pausado);
  useEffect(() => {
    limparRef.current = limpar;
    pausadoRef.current = pausado;
  });

  useEffect(() => {
    let sujo = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const disparar = () => {
      timer = null;
      if (pausadoRef.current) {
        timer = setTimeout(disparar, 10_000);
        return;
      }
      if (!sujo) return;
      sujo = false;
      limparRef.current();
    };

    const tocou = () => {
      sujo = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(disparar, INATIVIDADE_MS);
    };

    for (const e of EVENTOS) window.addEventListener(e, tocou, { capture: true, passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      for (const e of EVENTOS) window.removeEventListener(e, tocou, { capture: true });
    };
  }, []);
}
