import { describe, expect, it } from "vitest";
import {
  ATALHOS,
  MAXIMO_DE_FAIXAS,
  cruzaAMeiaNoite,
  faixasDoAtalho,
  lerJanela,
  novaFaixa,
  primeiroProblemaDaJanela,
  problemasDaJanela,
} from "@/lib/janela-do-produto";
import type { TimeWindow } from "@/lib/types";

/**
 * Regras puras do editor de horário do produto (JM-006). A regra de verdade é do banco
 * (jm_windows_valid e jm_windows_open, conferidas no pgTAP); aqui se prova que o editor
 * não deixa passar o que o banco ou o zod do servidor recusariam, e não recusa o que eles
 * aceitam.
 */
const faixa = (dow: number, open: string, close: string): TimeWindow => ({ dow, open, close });

describe("problemasDaJanela", () => {
  it("nulo é sempre disponível, e não tem problema", () => {
    expect(problemasDaJanela(null)).toEqual({ geral: null, faixas: [] });
    expect(primeiroProblemaDaJanela(null)).toBeNull();
  });

  it("lista vazia é bloqueada: o banco aceita, mas o produto sumiria em qualquer horário", () => {
    expect(problemasDaJanela([]).geral).toMatch(/horário nenhum/);
    expect(primeiroProblemaDaJanela([])).not.toBeNull();
  });

  it("aceita faixa comum e faixa que cruza a meia-noite", () => {
    const janela = [faixa(1, "11:30", "15:00"), faixa(5, "18:00", "02:00")];
    expect(problemasDaJanela(janela)).toEqual({ geral: null, faixas: [null, null] });
  });

  it("aceita almoço e jantar no mesmo dia, como jm_windows_valid", () => {
    expect(primeiroProblemaDaJanela([faixa(6, "11:30", "15:00"), faixa(6, "18:00", "23:00")])).toBeNull();
  });

  it("aceita os extremos do relógio, 00:00 e 23:59", () => {
    expect(primeiroProblemaDaJanela([faixa(0, "00:00", "23:59")])).toBeNull();
  });

  it("recusa abertura igual ao fechamento, como o banco", () => {
    const p = problemasDaJanela([faixa(2, "12:00", "12:00")]);
    expect(p.faixas[0]).toMatch(/iguais/);
  });

  it("recusa hora fora do formato HH:MM, inclusive o campo apagado", () => {
    expect(problemasDaJanela([faixa(1, "", "15:00")]).faixas[0]).toMatch(/abertura/);
    expect(problemasDaJanela([faixa(1, "11:30", "24:00")]).faixas[0]).toMatch(/fechamento/);
    expect(problemasDaJanela([faixa(1, "9:30", "15:00")]).faixas[0]).toMatch(/abertura/);
    expect(problemasDaJanela([faixa(1, "11:30:00", "15:00")]).faixas[0]).toMatch(/abertura/);
  });

  it("recusa dia fora de 0 a 6", () => {
    expect(problemasDaJanela([faixa(7, "11:30", "15:00")]).faixas[0]).toMatch(/dia/);
    expect(problemasDaJanela([faixa(-1, "11:30", "15:00")]).faixas[0]).toMatch(/dia/);
  });

  it(`aceita ${MAXIMO_DE_FAIXAS} faixas e recusa a seguinte, como o zod do servidor`, () => {
    const sete = faixasDoAtalho("jantar");
    expect(sete).toHaveLength(MAXIMO_DE_FAIXAS);
    expect(problemasDaJanela(sete).geral).toBeNull();
    expect(problemasDaJanela([...sete, faixa(1, "11:30", "15:00")]).geral).toMatch(/No máximo 7/);
  });

  it("aponta a primeira faixa errada, numerada a partir de 1", () => {
    expect(primeiroProblemaDaJanela([faixa(1, "11:30", "15:00"), faixa(2, "10:00", "10:00")])).toMatch(/^Faixa 2: /);
  });
});

describe("atalhos", () => {
  it("almoço e jantar preenchem os sete dias com o horário típico, e passam na validação", () => {
    for (const atalho of ["almoco", "jantar"] as const) {
      const faixas = faixasDoAtalho(atalho);
      expect(faixas.map((f) => f.dow)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(faixas.every((f) => f.open === ATALHOS[atalho].open && f.close === ATALHOS[atalho].close)).toBe(true);
      expect(primeiroProblemaDaJanela(faixas)).toBeNull();
    }
  });

  it("cada chamada devolve uma lista nova, que o gestor pode editar sem mexer no atalho", () => {
    const a = faixasDoAtalho("almoco");
    a[0].open = "10:00";
    expect(faixasDoAtalho("almoco")[0].open).toBe(ATALHOS.almoco.open);
  });
});

describe("novaFaixa", () => {
  it("lista vazia começa na segunda, no horário do almoço", () => {
    expect(novaFaixa([])).toEqual(faixa(1, ATALHOS.almoco.open, ATALHOS.almoco.close));
  });

  it("repete o horário da última faixa e pega o próximo dia livre", () => {
    expect(novaFaixa([faixa(1, "12:00", "14:30")])).toEqual(faixa(2, "12:00", "14:30"));
    expect(novaFaixa([faixa(1, "12:00", "14:30"), faixa(3, "19:00", "23:00")])).toEqual(faixa(2, "19:00", "23:00"));
  });

  it("com segunda a sábado ocupados, sobra o domingo", () => {
    const seis = [1, 2, 3, 4, 5, 6].map((dow) => faixa(dow, "18:00", "23:00"));
    expect(novaFaixa(seis).dow).toBe(0);
  });
});

describe("cruzaAMeiaNoite", () => {
  it("fechamento menor que a abertura cruza; maior não cruza", () => {
    expect(cruzaAMeiaNoite(faixa(5, "18:00", "02:00"))).toBe(true);
    expect(cruzaAMeiaNoite(faixa(5, "11:30", "15:00"))).toBe(false);
  });

  it("hora incompleta não é tratada como cruzamento", () => {
    expect(cruzaAMeiaNoite(faixa(5, "18:00", ""))).toBe(false);
  });
});

describe("lerJanela", () => {
  it("nulo continua nulo: sempre disponível", () => {
    expect(lerJanela(null)).toBeNull();
    expect(lerJanela(undefined)).toBeNull();
  });

  it("dia em texto vira número e chave a mais sai, para o zod estrito do servidor aceitar a volta", () => {
    expect(lerJanela([{ dow: "3", open: "11:30", close: "15:00", extra: true }])).toEqual([faixa(3, "11:30", "15:00")]);
  });

  it("formato ilegível vira lista vazia, que bloqueia a gravação, e nunca sempre disponível", () => {
    expect(lerJanela({ dow: 1 })).toEqual([]);
    expect(lerJanela([{ dow: 9, open: "11:30", close: "15:00" }])).toEqual([]);
    expect(lerJanela([{ dow: null, open: "11:30", close: "15:00" }])).toEqual([]);
    expect(primeiroProblemaDaJanela(lerJanela("qualquer coisa"))).not.toBeNull();
  });

  it("abre as faixas em ordem de dia e de abertura, domingo primeiro, sem perder nenhuma", () => {
    const lida = lerJanela([
      { dow: 6, open: "18:00", close: "23:00" },
      { dow: 1, open: "18:00", close: "23:00" },
      { dow: 1, open: "11:30", close: "15:00" },
      { dow: 0, open: "12:00", close: "16:00" },
    ]);
    expect(lida).toEqual([
      faixa(0, "12:00", "16:00"),
      faixa(1, "11:30", "15:00"),
      faixa(1, "18:00", "23:00"),
      faixa(6, "18:00", "23:00"),
    ]);
  });

  it("hora errada é lida como veio, para o editor apontar a faixa em vez de apagá-la", () => {
    const lida = lerJanela([{ dow: 1, open: "25:00", close: "15:00" }]);
    expect(lida).toEqual([faixa(1, "25:00", "15:00")]);
    expect(problemasDaJanela(lida).faixas[0]).toMatch(/abertura/);
  });
});
