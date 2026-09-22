"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Som de pedido novo (JM-121) e de chamado. O navegador só toca áudio depois de um gesto
 * da pessoa, então a tela começa com "Ativar som", e o som é gerado ali mesmo, sem arquivo.
 */
export function useSom() {
  const contexto = useRef<AudioContext | null>(null);
  const [ligado, setLigado] = useState(false);

  const bip = useCallback((frequencias: number[]) => {
    const ctx = contexto.current;
    if (!ctx || ctx.state !== "running") return;
    let t = ctx.currentTime;
    for (const f of frequencias) {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      ganho.gain.setValueAtTime(0.0001, t);
      ganho.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(ganho).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
      t += 0.26;
    }
  }, []);

  const tocar = useCallback((tipo: "pedido" | "chamado") => bip(tipo === "pedido" ? [880, 1175] : [660, 660, 660]), [bip]);

  const alternar = useCallback(() => {
    if (ligado) {
      void contexto.current?.suspend();
      setLigado(false);
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    contexto.current ??= new Ctor();
    void contexto.current.resume().then(() => {
      setLigado(true);
      bip([880, 1175]);
    });
  }, [ligado, bip]);

  return { ligado, alternar, tocar };
}
