"use client";

import { useEffect } from "react";
import { getMenuSource } from "@/lib/menu-source";

/** Batida do tablet: último contato, versão e bateria (JM-184). */
export const HEARTBEAT_MS = 60_000;
/** Travado por mais que isto, o app se recarrega (JM-184). */
export const TRAVADO_MS = 60_000;
const PULSO_MS = 5_000;

interface BateriaDoNavegador {
  level: number;
}

async function nivelDaBateria(): Promise<number | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BateriaDoNavegador> };
  if (typeof nav.getBattery !== "function") return null;
  try {
    const b = await nav.getBattery();
    return Math.round(b.level * 100);
  } catch {
    return null;
  }
}

/**
 * Saúde do tablet pareado (JM-184). Só liga na fonte real, com o tablet pareado: em
 * celular ou notebook de demonstração, recarregar a tela por aba em segundo plano seria
 * defeito, e não cuidado.
 *
 * - **Watchdog:** um pulso a cada 5 s anota a hora. Se entre dois pulsos passou mais de
 *   60 s, a página ficou travada (ou o aparelho dormiu), e ela se recarrega. O que trava
 *   de vez o navegador é assunto do navegador kiosk (NF-018).
 * - **Heartbeat:** ao ligar e a cada 60 s, com a versão do app e a bateria, quando o
 *   navegador informa. Falha é silenciosa: o polling já avisa a falta de rede.
 */
export function useSaudeDoTablet(ligado: boolean) {
  useEffect(() => {
    if (!ligado) return;

    let ultimoPulso = Date.now();
    const pulso = setInterval(() => {
      const agora = Date.now();
      if (agora - ultimoPulso > TRAVADO_MS) {
        window.location.reload();
        return;
      }
      ultimoPulso = agora;
    }, PULSO_MS);

    const bater = async () => {
      const bateria = await nivelDaBateria();
      const versao = process.env.NEXT_PUBLIC_APP_VERSION ?? null;
      await getMenuSource()
        .heartbeat({ versao, bateria })
        .catch(() => {
          // O polling mostra "sem conexão" e a tela de não pareado; aqui não há o que fazer.
        });
    };
    void bater();
    const batida = setInterval(() => void bater(), HEARTBEAT_MS);

    return () => {
      clearInterval(pulso);
      clearInterval(batida);
    };
  }, [ligado]);
}
