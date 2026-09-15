/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";

/**
 * Service worker do tablet (NF-004).
 *
 * Duas regras que vêm do documento, e não são detalhe:
 *
 * 1. O cardápio vai **pela rede primeiro**, e a última versão boa fica guardada para quando
 *    a rede do salão cair. Até 15/09/2026 era stale-while-revalidate, e isso mostrava a
 *    versão anterior da tela na primeira abertura depois de cada atualização (NF-004
 *    revisto).
 * 2. **Nada que escreve é cacheado.** Pixel e, na Fase B, o envio de pedido vão para a
 *    rede ou falham na cara do cliente. Pedido que parece aceito e não chegou à cozinha
 *    é o defeito que o JM-185 existe para evitar.
 */
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };

/**
 * Nunca no cache: tela e dados da equipe, e a tela de pareamento do tablet, cuja URL traz
 * o código de uso único. O NF-004 pede cache só do cardápio do cliente.
 */
const ROTAS_SEM_CACHE = /^\/(login|admin|api\/admin)(\/|$)|^\/[^/]+\/tablet\/setup(\/|$)/;

/** Rede lenta demais: depois deste tempo, a tela abre com a última versão guardada. */
const ESPERA_DA_REDE_S = 4;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // Só pela rede, e esta regra vem primeiro. Com a tela de login no cache, a primeira
      // visita depois de um deploy recebia o HTML anterior, com o identificador antigo da
      // server action, e o login quebrava ("Failed to find Server Action"). Dado do admin
      // (e-mails, dispositivos) e a URL de pareamento, com o código, também não ficam no
      // Cache Storage do aparelho.
      matcher: ({ url, sameOrigin }) => sameOrigin && ROTAS_SEM_CACHE.test(url.pathname),
      handler: new NetworkOnly(),
    },
    {
      // Toda escrita é só rede: nunca cache, nunca fila que finge sucesso.
      matcher: ({ request }) => request.method !== "GET",
      handler: new NetworkOnly(),
    },
    {
      // A tela do cliente: com rede, sempre a versão nova; sem rede, a última guardada.
      matcher: ({ request, sameOrigin }) =>
        sameOrigin && request.mode === "navigate" && request.destination === "document",
      handler: new NetworkFirst({
        cacheName: "jm-telas",
        networkTimeoutSeconds: ESPERA_DA_REDE_S,
        plugins: [new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 7, maxEntries: 16 })],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
