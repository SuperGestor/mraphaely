import { describe, expect, it } from "vitest";
import {
  MAXIMO_DA_REGUA,
  MINIMO_DA_REGUA,
  lerDestaque,
  lerPainel,
  lerRegua,
  painelVazio,
  pisoDeAparicoes,
  porcentagemDaRegua,
  rotuloDaRegua,
  rotuloDeConversao,
  rotuloDoTurno,
  type LinhaDoPainel,
  type ReguaDoPainel,
} from "@/lib/painel-do-cardapio";
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
  deserve_highlight: [],
  never_seen: [],
  low_seen: [],
  seen_no_conversion: [],
  champions: [],
};

/** Uma linha qualquer, para os testes só mexerem no que importa em cada caso. */
const linha = (mudanca: Partial<LinhaDoPainel>): LinhaDoPainel => ({
  product_id: "p1",
  name: "Caipirinha de caju",
  category: "Drinks do jardim",
  in_menu: true,
  impressions: 0,
  clicks: 0,
  adds_to_cart: 0,
  orders: 0,
  quantity: 0,
  conversion: null,
  ...mudanca,
});

const reguaDe = (mudanca: Partial<ReguaDoPainel>): ReguaDoPainel => ({
  low_view_fraction: 0.25,
  median_impressions: null,
  low_view_max: null,
  champion_min_impressions: null,
  champions_limit: 10,
  ...mudanca,
});

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
    const todas = [
      ...painel.deserve_highlight,
      ...painel.never_seen,
      ...painel.low_seen,
      ...painel.seen_no_conversion,
      ...painel.champions,
    ];
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

  it("no exemplo, quem merece destaque vende, aparece pouco e saiu das listas de cortar", () => {
    const painel = lerPainel(mockPainelDoCardapio());
    const piso = pisoDeAparicoes(painel.rules);

    expect(painel.deserve_highlight.length).toBeGreaterThan(0);
    for (const l of painel.deserve_highlight) {
      expect(l.orders).toBeGreaterThan(0);
      expect(l.impressions).toBeLessThanOrEqual(piso);
    }

    // Produto que vende não pode aparecer nas listas de "considere tirar do cardápio".
    const paraCortar = [...painel.never_seen, ...painel.low_seen].map((l) => l.product_id);
    for (const l of painel.deserve_highlight) expect(paraCortar).not.toContain(l.product_id);
    for (const l of [...painel.never_seen, ...painel.low_seen]) expect(l.orders).toBe(0);

    // O exemplo cobre os dois casos que a tela conta de jeito diferente.
    expect(painel.deserve_highlight.some((l) => l.impressions === 0)).toBe(true);
    expect(painel.deserve_highlight.some((l) => l.impressions > 0)).toBe(true);
  });

  it("no exemplo, a lista de destaque vem com os mais vendidos primeiro", () => {
    const pedidos = lerPainel(mockPainelDoCardapio()).deserve_highlight.map((l) => l.orders);
    expect(pedidos).toEqual([...pedidos].sort((a, b) => b - a));
  });
});

describe("merece destaque, a frase que explica a linha", () => {
  it("compara pedidos com aparições, no plural certo", () => {
    expect(lerDestaque(linha({ orders: 5, impressions: 6 })).frase).toBe("Pedido 5 vezes em apenas 6 aparições na tela.");
    expect(lerDestaque(linha({ orders: 1, impressions: 1 })).frase).toBe("Pedido 1 vez em apenas 1 aparição na tela.");
    expect(lerDestaque(linha({ orders: 2, impressions: 1 })).frase).toBe("Pedido 2 vezes em apenas 1 aparição na tela.");
  });

  it("sem aparição registrada, não afirma que o produto não apareceu", () => {
    const leitura = lerDestaque(linha({ orders: 2, impressions: 0 }));
    expect(leitura.semRegistro).toBe(true);
    expect(leitura.frase).toBe("Pedido 2 vezes, e nenhuma aparição na tela chegou a ser registrada.");
    // A tela não pode prometer conversão onde não há denominador.
    expect(leitura.frase).not.toContain("%");
  });

  it("com aparição, a linha não é marcada como sem registro", () => {
    expect(lerDestaque(linha({ orders: 1, impressions: 9 })).semRegistro).toBe(false);
  });
});

describe("a régua da casa", () => {
  it("mostra a fração do banco como porcentagem inteira", () => {
    expect(porcentagemDaRegua(reguaDe({ low_view_fraction: 0.25 }))).toBe(25);
    expect(porcentagemDaRegua(reguaDe({ low_view_fraction: 0.4 }))).toBe(40);
    expect(porcentagemDaRegua(reguaDe({ low_view_fraction: 1 }))).toBe(100);
  });

  it("o piso é o inteiro que ainda cabe na comparação do banco", () => {
    expect(pisoDeAparicoes(reguaDe({ median_impressions: 74, low_view_max: 18.5 }))).toBe(18);
    expect(pisoDeAparicoes(reguaDe({ median_impressions: 40, low_view_max: 10 }))).toBe(10);
    // Sem mediana, só entra quem não tem registro nenhum.
    expect(pisoDeAparicoes(reguaDe({}))).toBe(0);
  });

  it("diz o efeito do número em palavras, com a mediana do turno à vista", () => {
    const frase = rotuloDaRegua(reguaDe({ low_view_fraction: 0.25, median_impressions: 74, low_view_max: 18.5 }));
    expect(frase).toContain("74 aparições");
    expect(frase).toContain("25%");
    expect(frase).toContain("no máximo 18 vezes");
  });

  it("com mediana quebrada, escreve o número como o Brasil escreve", () => {
    expect(rotuloDaRegua(reguaDe({ median_impressions: 78.5, low_view_max: 19.625 }))).toContain("78,5 aparições");
  });

  it("sem mediana, diz que não há com o que comparar em vez de inventar um piso", () => {
    const frase = rotuloDaRegua(reguaDe({}));
    expect(frase).toContain("nenhum produto apareceu na tela ainda");
    expect(frase).toContain("sem nenhuma aparição registrada");
  });

  it("quando a porcentagem não chega a uma aparição, diz isso em vez de 'no máximo 0 vezes'", () => {
    const frase = rotuloDaRegua(reguaDe({ low_view_fraction: 0.01, median_impressions: 8, low_view_max: 0.08 }));
    expect(frase).toContain("sem nenhuma aparição registrada");
    expect(frase).not.toContain("0 vezes");
  });

  it("recusa antes do servidor o que a function recusaria com JM422", () => {
    expect(lerRegua(String(MINIMO_DA_REGUA))).toEqual({ ok: true, pct: 1 });
    expect(lerRegua(` ${MAXIMO_DA_REGUA} `)).toEqual({ ok: true, pct: 100 });
    expect(lerRegua("25")).toEqual({ ok: true, pct: 25 });

    for (const ruim of ["", "   ", "abc", "25%", "12,5", "12.5", "-3"]) {
      expect(lerRegua(ruim).ok).toBe(false);
    }
    expect(lerRegua("0").ok).toBe(false);
    expect(lerRegua("101").ok).toBe(false);
  });

  it("ao recusar, diz o limite, e não só que está errado", () => {
    const fora = lerRegua("0");
    expect(fora.ok).toBe(false);
    if (!fora.ok) expect(fora.problema).toContain("de 1% a 100%");
  });
});

describe("painel do cardápio, o resto", () => {

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
    expect(painel.deserve_highlight).toEqual([]);
    expect(painelVazio(painel)).toBe(true);
  });

  it("turno com só um produto em destaque não é turno vazio", () => {
    // Se "merece destaque" ficasse de fora da conta, a tela mandaria o dono procurar tablet
    // sem rede justamente quando há uma venda escondida para ele olhar.
    const painel = lerPainel({ ...vazio, deserve_highlight: [linha({ orders: 2, impressions: 0 })] });
    expect(painelVazio(painel)).toBe(false);
  });

  it("recusa jsonb com chave faltando, para a tela cair no erro e não no meio do desenho", () => {
    const semTotais: Record<string, unknown> = { ...vazio };
    delete semTotais.totals;
    expect(() => lerPainel(semTotais)).toThrow();
    const semDestaque: Record<string, unknown> = { ...vazio };
    delete semDestaque.deserve_highlight;
    expect(() => lerPainel(semDestaque)).toThrow();
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
