import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Testes de unidade (Vitest): regras puras do front e do back que não precisam de banco.
 * O que depende do Postgres está no pgTAP (back/supabase/tests), e o fluxo de ponta a
 * ponta, no Playwright (tests/e2e).
 */
const aqui = (caminho: string) => fileURLToPath(new URL(caminho, import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@back": aqui("../back"), "@": aqui(".") },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
