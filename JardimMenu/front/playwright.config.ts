import { defineConfig } from "@playwright/test";

/**
 * E2E da Fase B (§9.2), contra o Supabase local com a massa de back/supabase/seed.sql e o
 * build de produção com `NEXT_PUBLIC_DATA_SOURCE=supabase`.
 *
 * Antes de rodar: `npx supabase start`, `npx supabase db reset` (massa limpa: os testes
 * contam pedidos e aberturas) e `npm run build`. Cada arquivo usa mesas próprias da massa,
 * para os cenários não se cruzarem, e roda em série: há um banco só.
 *
 * O navegador é o Chrome da máquina (`channel: "chrome"`): nada é baixado. O service worker
 * fica bloqueado, porque o E2E mede o comportamento da rede, e não do cache (o NF-004 tem
 * verificação própria).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_URL ?? "http://localhost:3000",
    channel: "chrome",
    viewport: { width: 1280, height: 800 },
    locale: "pt-BR",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  // O servidor é o do `output: "standalone"`, o mesmo server.js que a imagem Docker
  // publica (front/Dockerfile). `next start` não funciona com standalone — o Next avisa —
  // e verificar num servidor que ninguém executa em produção não prova o que precisa.
  webServer: {
    command: "npm run start:standalone",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
