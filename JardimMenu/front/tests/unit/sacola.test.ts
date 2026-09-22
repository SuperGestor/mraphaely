import { describe, expect, it } from "vitest";
import { mesmaEscolha, paraOEnvio, rotuloDeItens, somarEmCentavos, type ItemDaSacola } from "@/lib/sacola";
import type { MenuProduct } from "@/lib/types";

const produto = { id: "p1", name: "Chopp", option_groups: [] } as unknown as MenuProduct;
let n = 0;
const linha = (total: number | null, over: Partial<ItemDaSacola> = {}): ItemDaSacola => ({
  chave: `l${++n}`,
  produto,
  quantity: 1,
  option_ids: [],
  notes: null,
  total: total === null ? null : { unit_total: total, line_total: total },
  erro: false,
  ...over,
});

describe("sacola (JM-183, JM-031)", () => {
  it("soma em centavos inteiros, sem erro de ponto flutuante", () => {
    expect(somarEmCentavos([linha(0.1), linha(0.2)])).toBe(0.3);
    expect(somarEmCentavos([linha(16.9), linha(19.9), linha(39.9)])).toBe(76.7);
  });

  it("sem total enquanto alguma linha recalcula", () => {
    expect(somarEmCentavos([linha(10), linha(null)])).toBeNull();
  });

  it("mesma escolha: complementos em qualquer ordem e a mesma observação", () => {
    expect(mesmaEscolha({ option_ids: ["a", "b"], notes: null }, { option_ids: ["b", "a"], notes: "" })).toBe(true);
    expect(mesmaEscolha({ option_ids: ["a"], notes: "sem gelo" }, { option_ids: ["a"], notes: null })).toBe(false);
  });

  it("o envio leva só identificadores, quantidade e observação, nunca preço", () => {
    const [item] = paraOEnvio([linha(32, { quantity: 2, option_ids: ["o1"], notes: "bem passado" })]);
    expect(item).toEqual({ product_id: "p1", quantity: 2, option_ids: ["o1"], notes: "bem passado" });
    expect(JSON.stringify(item)).not.toMatch(/total|price/);
  });

  it("rótulo de itens no singular e no plural", () => {
    expect(rotuloDeItens(1)).toBe("1 item");
    expect(rotuloDeItens(3)).toBe("3 itens");
  });
});
