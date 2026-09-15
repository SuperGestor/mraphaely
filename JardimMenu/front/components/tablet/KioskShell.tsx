"use client";

import { useEffect } from "react";
import { CHAVE_DO_TOKEN } from "@/lib/tablet-source";

/**
 * Dois cuidados de kiosk que só existem no cliente, e nenhum deles substitui a
 * configuração do aparelho (NF-018):
 *
 * 1. **Orientação travada, só no tablet pareado.** A tela do cliente é responsiva desde
 *    15/09/2026 (JM-007 revisto): em celular, notebook ou tablet sem pareamento, ela segue
 *    a orientação do aparelho. No tablet da mesa, pede a paisagem quando o navegador
 *    permite. Fora de tela cheia isso é recusado, e a recusa é silenciosa de propósito:
 *    quem trava de verdade é o navegador kiosk.
 * 2. **Service worker** (NF-004): registra o `/sw.js` gerado pelo Serwist. Em
 *    desenvolvimento o arquivo não existe, e o registro falha em silêncio.
 */
export function KioskShell() {
  useEffect(() => {
    let pareado = false;
    try {
      pareado = Boolean(window.localStorage.getItem(CHAVE_DO_TOKEN));
    } catch {
      // Armazenamento bloqueado: não é o tablet da mesa, que guarda o token.
    }
    if (!pareado) return;

    const orientacao = screen.orientation as
      | (ScreenOrientation & { lock?: (o: string) => Promise<void> })
      | undefined;
    orientacao?.lock?.("landscape").catch(() => {
      // Sem tela cheia, o navegador recusa. O kiosk é quem trava (NF-018).
    });
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Em desenvolvimento o Serwist não gera o arquivo, e isso é esperado.
    });
  }, []);

  return null;
}
