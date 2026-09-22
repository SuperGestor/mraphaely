import { describe, expect, it } from "vitest";
import { assinaturaDoEnvio, criarGuardaDeChave, novaChave } from "@/lib/idempotencia";
import type { EnvioDoPedido } from "@/lib/mesa";

const envio = (over: Partial<EnvioDoPedido> = {}): EnvioDoPedido => ({
  session_id: "00000000-0000-4000-8000-000000000001",
  tab_id: "00000000-0000-4000-8000-000000000002",
  items: [{ product_id: "00000000-0000-4000-8000-000000000003", quantity: 2, option_ids: ["b", "a"], notes: null }],
  ...over,
});

describe("chave de idempotência (JM-032)", () => {
  it("tem 128 bits no formato que a function aceita", () => {
    const chave = novaChave();
    expect(chave).toMatch(/^[0-9a-f]{32}$/);
    expect(chave).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it("não se repete", () => {
    const chaves = new Set(Array.from({ length: 500 }, novaChave));
    expect(chaves.size).toBe(500);
  });

  it("a assinatura ignora a ordem dos complementos, e não a quantidade", () => {
    const a = envio();
    const b = envio({ items: [{ ...a.items[0], option_ids: ["a", "b"] }] });
    expect(assinaturaDoEnvio(a)).toBe(assinaturaDoEnvio(b));
    expect(assinaturaDoEnvio(envio({ items: [{ ...a.items[0], quantity: 3 }] }))).not.toBe(assinaturaDoEnvio(a));
  });

  it("repete a chave enquanto o envio não muda, e troca quando muda", () => {
    const guarda = criarGuardaDeChave();
    const primeira = guarda.para(envio());
    expect(guarda.para(envio())).toBe(primeira);
    expect(guarda.para(envio({ tab_id: "00000000-0000-4000-8000-000000000009" }))).not.toBe(primeira);
  });

  it("depois do pedido aceito, o mesmo conteúdo é outro pedido", () => {
    const guarda = criarGuardaDeChave();
    const primeira = guarda.para(envio());
    guarda.esquecer();
    expect(guarda.para(envio())).not.toBe(primeira);
  });
});
