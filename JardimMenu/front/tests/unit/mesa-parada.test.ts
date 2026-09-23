import { describe, expect, it } from "vitest";
import {
  MAXIMO_DE_MESA_PARADA,
  MINIMO_DE_MESA_PARADA,
  PADRAO_DE_MESA_PARADA,
  lerMinutosDeMesaParada,
  rotuloDeDuracao,
} from "@/lib/mesa-parada";

/** Tempo de mesa parada (JM-122): a leitura do campo e o rótulo em horas e minutos. */
describe("tempo de mesa parada", () => {
  it("rotula duração em horas e minutos, sem o 'há' da tela da equipe", () => {
    expect(rotuloDeDuracao(0)).toBe("0 min");
    expect(rotuloDeDuracao(MINIMO_DE_MESA_PARADA)).toBe("30 min");
    expect(rotuloDeDuracao(59)).toBe("59 min");
    expect(rotuloDeDuracao(60)).toBe("1 h");
    expect(rotuloDeDuracao(90)).toBe("1 h 30 min");
    expect(rotuloDeDuracao(PADRAO_DE_MESA_PARADA)).toBe("3 h");
    expect(rotuloDeDuracao(MAXIMO_DE_MESA_PARADA)).toBe("24 h");
  });

  it("aceita inteiro dentro da faixa do banco, com espaço em volta", () => {
    expect(lerMinutosDeMesaParada("30")).toEqual({ ok: true, minutos: 30 });
    expect(lerMinutosDeMesaParada(" 180 ")).toEqual({ ok: true, minutos: 180 });
    expect(lerMinutosDeMesaParada("1440")).toEqual({ ok: true, minutos: 1440 });
  });

  it("recusa vazio, texto e número quebrado, dizendo o que fazer", () => {
    for (const entrada of ["", "   ", "abc", "30,5", "30.5", "-30", "1e3", "180min"]) {
      const leitura = lerMinutosDeMesaParada(entrada);
      expect(leitura.ok, entrada).toBe(false);
      if (!leitura.ok) expect(leitura.problema.length).toBeGreaterThan(0);
    }
  });

  it("recusa fora da faixa e diz o limite, que é o mesmo do CHECK do banco", () => {
    for (const entrada of ["0", "29", "1441", "99999"]) {
      const leitura = lerMinutosDeMesaParada(entrada);
      expect(leitura.ok, entrada).toBe(false);
      if (!leitura.ok) {
        expect(leitura.problema).toContain("30");
        expect(leitura.problema).toContain("1440");
      }
    }
  });
});
