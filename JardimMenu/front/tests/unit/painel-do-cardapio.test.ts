import { describe, expect, it } from "vitest";
import { lerPainel, painelVazio, rotuloDeConversao, rotuloDoTurno } from "@/lib/painel-do-cardapio";
import { mockPainelDoCardapio } from "@/lib/mock/admin";

/**
 * Painel do cardápio (JM-062): a leitura do jsonb de `admin_menu_panel` e os rótulos.
 *
 * O painel de exemplo é lido pelo MESMO zod do painel real, de propósito: é isso que prova
 * que o modo de exemplo não quebra a tela e que o formato dos dois lados é um só.
 */
const vazio = {
  business_date: "2026-09-22",
  current_business_date: "2026-09-22",
  previous_business_date: "2026-09-21",
  next_business_date: null,
  rules: {
    low_view_fraction: 0.25,
    median_impressions: null,
    low_view_max: null,
    champion_min_impressions: null,
    champions_limit: 10,
  },
  totals: { impressions: 0, clicks: 0, adds_to_cart: 0, ordered_products: 0, orders: 0, products: 0 },
  never_seen: [],
  low_seen: [],
  seen_no_conversion: [],
  champions: [],
};

describe("painel do cardápio", () => {
  it("lê o painel de exemplo com o zod do painel real", () => {
    const painel = lerPainel(mockPainelDoCardapio());
    expect(painel.business_date).toBe("2026-09-22");
    expect(painel.never_seen.length + painel.low_seen.length).toBeGreaterThan(0);
    expect(painel.champions.length).toBeGreaterThan(0);
    expect(painelVazio(painel)).toBe(false);
  });

  it("no exemplo, os totais somam as mesmas linhas que as listas mostram", () => {
    const painel = lerPainel(mockPainelDoCardapio());
    const todas = [...painel.never_seen, ...painel.low_seen, ...painel.seen_no_conversion, ...painel.champions];
    expect(painel.totals.products).toBe(todas.length);
    expect(painel.totals.impressions).toBe(todas.reduce((t, l) => t + l.impressions, 0));
    expect(painel.totals.clicks).toBe(todas.reduce((t, l) => t + l.clicks, 0));
    expect(painel.totals.adds_to_cart).toBe(todas.reduce((t, l) => t + l.adds_to_cart, 0));
    expect(painel.totals.ordered_products).toBe(todas.filter((l) => l.orders > 0).length);
  });

  it("no exemplo, a régua do 'pouco visto' e a dos campeões batem com as listas", () => {
    const painel = lerPainel(mockPainelDoCardapio());
    const teto = painel.rules.low_view_max ?? 0;
    for (const l of painel.low_seen) {
      expect(l.impressions).toBeGreaterThan(0);
      expect(l.impressions).toBeLessThanOrEqual(teto);
    }
    const piso = painel.rules.champion_min_impressions ?? 0;
    for (const l of painel.champions) {
      expect(l.orders).toBeGreaterThan(0);
      expect(l.impressions).toBeGreaterThanOrEqual(piso);
    }
    for (const l of painel.never_seen) expect(l.impressions).toBe(0);
    for (const l of painel.seen_no_conversion) expect(l.orders).toBe(0);
  });

  it("aceita numeric que chega como texto, que é o que alguns drivers devolvem", () => {
    const painel = lerPainel({
      ...vazio,
      rules: { ...vazio.rules, median_impressions: "40", low_view_max: "10", champion_min_impressions: "40" },
      totals: { ...vazio.totals, impressions: "12", products: "1" },
      champions: [
        {
          product_id: "p1",
          name: "Chopp Pilsen da casa",
          category: "Chopp e cerveja",
          in_menu: true,
          impressions: "12",
          clicks: "8",
          adds_to_cart: "5",
          orders: "3",
          quantity: "7",
          conversion: "0.2500",
        },
      ],
    });
    expect(painel.rules.median_impressions).toBe(40);
    expect(painel.champions[0]?.impressions).toBe(12);
    expect(painel.champions[0]?.conversion).toBe(0.25);
  });

  it("mantém nulo o que é nulo: sem impressão não existe taxa nem mediana", () => {
    const painel = lerPainel(vazio);
    expect(painel.rules.median_impressions).toBeNull();
    expect(painel.next_business_date).toBeNull();
    expect(painelVazio(painel)).toBe(true);
  });

  it("recusa jsonb com chave faltando, para a tela cair no erro e não no meio do desenho", () => {
    const semTotais: Record<string, unknown> = { ...vazio };
    delete semTotais.totals;
    expect(() => lerPainel(semTotais)).toThrow();
    expect(() => lerPainel(null)).toThrow();
    expect(() => lerPainel({ ...vazio, business_date: "22/09/2026" })).toThrow();
  });

  it("formata o turno trocando a posição do texto, sem passar por Date", () => {
    // Um `new Date("2026-09-22")` seria meia-noite UTC e, em São Paulo, viraria dia 21.
    expect(rotuloDoTurno("2026-09-22")).toBe("22/09/2026");
    expect(rotuloDoTurno("2026-01-01")).toBe("01/01/2026");
  });

  it("mostra travessão quando não há conversão, e arredonda o resto", () => {
    expect(rotuloDeConversao(null)).toBe("—");
    expect(rotuloDeConversao(0)).toBe("0%");
    expect(rotuloDeConversao(0.4576)).toBe("46%");
    expect(rotuloDeConversao(1)).toBe("100%");
  });
});
