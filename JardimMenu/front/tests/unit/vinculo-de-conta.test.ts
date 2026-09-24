import { describe, expect, it } from "vitest";
import type { StoreUserRow } from "@/lib/types";
import { FalhaDoAdmin, casoDoVinculo, ehConflito, ehContaJaExiste } from "@/lib/admin-source";

/**
 * Vínculo de conta que já existe (JM-052), depois da decisão do PO de 24/09/2026: a mesma
 * function atende quem nunca esteve na loja e quem está voltando, e só a conta ATIVA segue
 * sendo conflito. A tela de usuários precisa dizer qual dos três casos é ANTES do toque,
 * porque voltar com papel diferente é mudança de permissão — é esta leitura que se testa.
 */
const usuario = (email: string, role: StoreUserRow["role"], is_active: boolean): StoreUserRow => ({
  id: `11111111-1111-1111-1111-11111111111${is_active ? 1 : 2}`,
  store_id: "22222222-2222-2222-2222-222222222222",
  user_id: "33333333-3333-3333-3333-333333333333",
  email,
  role,
  is_active,
});

const LISTA: StoreUserRow[] = [
  usuario("dono@jardimsecreto.com.br", "owner", true),
  usuario("salao@jardimsecreto.com.br", "waiter", false),
];

describe("caso do vínculo de conta que já existe", () => {
  it("sem lista carregada, não chuta: fica indefinido", () => {
    expect(casoDoVinculo(null, "qualquer@jardimsecreto.com.br")).toEqual({ tipo: "indefinido" });
  });

  it("quem não está na loja ganha acesso agora", () => {
    expect(casoDoVinculo(LISTA, "novo@jardimsecreto.com.br")).toEqual({ tipo: "nova" });
    expect(casoDoVinculo([], "novo@jardimsecreto.com.br")).toEqual({ tipo: "nova" });
  });

  it("quem está desativado está voltando, e traz o papel que tinha", () => {
    expect(casoDoVinculo(LISTA, "salao@jardimsecreto.com.br")).toEqual({
      tipo: "voltando",
      papelAnterior: "waiter",
    });
  });

  it("quem já está ativo não tem o que vincular, e traz o papel de hoje", () => {
    expect(casoDoVinculo(LISTA, "dono@jardimsecreto.com.br")).toEqual({ tipo: "ja_ativa", papel: "owner" });
  });

  it("acha a mesma conta que a function acharia: sem espaço em volta e sem caixa alta", () => {
    for (const digitado of ["  SALAO@jardimsecreto.com.br ", "Salao@JardimSecreto.com.BR", " salao@jardimsecreto.com.br"]) {
      expect(casoDoVinculo(LISTA, digitado), digitado).toEqual({ tipo: "voltando", papelAnterior: "waiter" });
    }
  });
});

describe("códigos que a tela de usuários separa", () => {
  it("JMU01 abre o caminho de vínculo; JM409 é a conta que já está ativa", () => {
    const jmu01 = new FalhaDoAdmin(409, "JMU01", "Este e-mail já tem conta.");
    const jm409 = new FalhaDoAdmin(409, "JM409", "Conflito com o estado atual.");

    expect(ehContaJaExiste(jmu01)).toBe(true);
    expect(ehConflito(jmu01)).toBe(false);

    expect(ehConflito(jm409)).toBe(true);
    expect(ehContaJaExiste(jm409)).toBe(false);
  });

  it("erro que não é do admin não vira nenhum dos dois caminhos", () => {
    for (const erro of [new Error("rede caiu"), null, undefined, "JM409"]) {
      expect(ehContaJaExiste(erro)).toBe(false);
      expect(ehConflito(erro)).toBe(false);
    }
  });
});
