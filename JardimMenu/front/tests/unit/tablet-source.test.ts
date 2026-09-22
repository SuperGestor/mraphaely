import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAVE_DA_MESA, CHAVE_DO_TOKEN, guardarMesa, lerMesaGuardada } from "@/lib/tablet-source";

/**
 * A mesa guardada no aparelho é o que a tela de "chame a equipe" mostra quando o token é
 * recusado (JM-181, JM-187). Uma expressão regular errada já deixou essa tela sem o número
 * da mesa, e só o E2E pegou: por isso o teste.
 */
function armazenamentoFalso(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  const armazenamento = {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
  };
  vi.stubGlobal("window", { localStorage: armazenamento });
  return dados;
}

afterEach(() => vi.unstubAllGlobals());

describe("mesa guardada no tablet", () => {
  it("lê o número que o pareamento gravou", () => {
    armazenamentoFalso({ [CHAVE_DA_MESA]: "6" });
    expect(lerMesaGuardada()).toBe(6);
  });

  it("aceita de 1 a 4 dígitos e recusa o resto", () => {
    for (const valor of ["1", "42", "9999"]) {
      armazenamentoFalso({ [CHAVE_DA_MESA]: valor });
      expect(lerMesaGuardada()).toBe(Number(valor));
    }
    for (const valor of ["", "12345", "6a", "-1", "d", "Mesa 6"]) {
      armazenamentoFalso({ [CHAVE_DA_MESA]: valor });
      expect(lerMesaGuardada()).toBeNull();
    }
  });

  it("sem nada guardado, devolve nulo", () => {
    armazenamentoFalso();
    expect(lerMesaGuardada()).toBeNull();
  });

  it("só guarda a mesa em aparelho pareado, e o servidor manda o número", () => {
    const semToken = armazenamentoFalso();
    guardarMesa(4);
    expect(semToken.get(CHAVE_DA_MESA)).toBeUndefined();

    const comToken = armazenamentoFalso({ [CHAVE_DO_TOKEN]: "token" });
    guardarMesa(4);
    expect(comToken.get(CHAVE_DA_MESA)).toBe("4");
    expect(lerMesaGuardada()).toBe(4);
  });
});
