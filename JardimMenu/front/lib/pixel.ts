"use client";

import type { Uuid } from "./types";

/**
 * Pixel de inteligência, lado do cliente (JM-060 a JM-064).
 *
 * O que o documento fixa, e está aqui:
 *
 * - **Anônimo por desenho** (JM-063): nenhum dado pessoal, nenhum cookie, e o
 *   `session_id` é sorteado por cliente. A renovação entre clientes é a `renovarSessao`,
 *   que a limpeza do JM-183 vai chamar na Fase B.
 * - **Lote de 8 s, 50 por lote e 600 por sessão por minuto** (JM-061). O excedente é
 *   descartado aqui e também no servidor, que responde 202 sem punir a sessão.
 * - **`sendBeacon` no fechamento**, para o último lote não morrer com a tela.
 *
 * O `product_impression` é disparado quando metade do card fica visível, uma vez por
 * produto por sessão (IntersectionObserver a 50%).
 */

export type EventoTipo =
  | "page_view"
  | "category_view"
  | "product_impression"
  | "product_view_time"
  | "product_click"
  | "add_to_cart"
  | "cart_open"
  | "order_submitted"
  | "waiter_call";

interface Evento {
  event_type: EventoTipo;
  product_id?: Uuid;
  category_id?: Uuid;
  value_ms?: number;
  at: string;
}

const ENDPOINT = "/api/track";
const INTERVALO_MS = 8_000;
const MAX_POR_LOTE = 50;
const MAX_POR_MINUTO = 600;

let sessionId: Uuid = "";
let storeId: Uuid | null = null;
let fila: Evento[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let janelaInicio = 0;
let janelaContagem = 0;
let descartados = 0;
const impressoesFeitas = new Set<string>();

function novaSessao(): Uuid {
  return crypto.randomUUID();
}

/** Limite de 600 por sessão por minuto (JM-061). Excedente é descartado, sem erro. */
function dentroDoLimite(): boolean {
  const agora = Date.now();
  if (agora - janelaInicio > 60_000) {
    janelaInicio = agora;
    janelaContagem = 0;
  }
  if (janelaContagem >= MAX_POR_MINUTO) {
    descartados += 1;
    return false;
  }
  janelaContagem += 1;
  return true;
}

function enviar(lote: Evento[], comBeacon: boolean) {
  if (!storeId || lote.length === 0) return;
  const corpo = JSON.stringify({ session_id: sessionId, store_id: storeId, events: lote });

  if (comBeacon && typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon(ENDPOINT, new Blob([corpo], { type: "application/json" }));
    return;
  }

  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: corpo,
    keepalive: true,
  }).catch(() => {
    // Pixel nunca atrapalha a tela do cliente: falha de rede é silenciosa.
  });
}

function descarregar(comBeacon = false) {
  while (fila.length > 0) {
    const lote = fila.slice(0, MAX_POR_LOTE);
    fila = fila.slice(MAX_POR_LOTE);
    enviar(lote, comBeacon);
    if (comBeacon) break; // no fechamento, um beacon só
  }
}

export function registrarEvento(
  tipo: EventoTipo,
  extra: { product_id?: Uuid; category_id?: Uuid; value_ms?: number } = {},
) {
  if (!storeId) return;
  if (!dentroDoLimite()) return;
  fila.push({ event_type: tipo, ...extra, at: new Date().toISOString() });
  if (fila.length >= MAX_POR_LOTE) descarregar();
}

/** Uma impressão por produto por sessão. */
export function registrarImpressao(productId: Uuid) {
  if (impressoesFeitas.has(productId)) return;
  impressoesFeitas.add(productId);
  registrarEvento("product_impression", { product_id: productId });
}

/** Chamada pela limpeza entre clientes (JM-183), na Fase B. */
export function renovarSessao() {
  descarregar();
  sessionId = novaSessao();
  impressoesFeitas.clear();
  janelaInicio = Date.now();
  janelaContagem = 0;
}

/** Só para conferência em teste e na rodada exploratória. */
export function estadoDoPixel() {
  return { sessionId, storeId, naFila: fila.length, descartados, janelaContagem };
}

/**
 * Liga o pixel para uma loja. Devolve a função de desligar, para o React limpar.
 */
export function iniciarPixel(loja: Uuid): () => void {
  storeId = loja;
  if (!sessionId) sessionId = novaSessao();
  janelaInicio = Date.now();

  if (timer) clearInterval(timer);
  timer = setInterval(() => descarregar(), INTERVALO_MS);

  const aoSair = () => descarregar(true);
  window.addEventListener("pagehide", aoSair);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") descarregar(true);
  });

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    window.removeEventListener("pagehide", aoSair);
    descarregar(true);
  };
}
