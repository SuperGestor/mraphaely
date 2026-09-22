import { describe, expect, it } from "vitest";
import { traduzErro } from "@back/errors";

describe("catálogo de erros (JM-100)", () => {
  it.each([
    ["JMS01", 404],
    ["JMS02", 409],
    ["JMS03", 403],
    ["JMT01", 404],
    ["JMT02", 409],
    ["JMT03", 403],
    ["JMT04", 409],
    ["JMT05", 422],
    ["JMC01", 423],
    ["JMH01", 423],
    ["JMK01", 428],
    ["JMW01", 425],
    ["JM410", 410],
    ["42501", 403],
  ])("%s vira HTTP %i, com código estável", (code, status) => {
    const r = traduzErro({ code, message: "texto interno do banco" });
    expect(r.status).toBe(status);
    expect(r.codigo).toBe(code);
    expect(r.mensagem).not.toContain("texto interno");
  });

  it("repassa o produto indisponível com acento e pontuação (JM-004)", () => {
    expect(traduzErro({ code: "JM451", message: "produto indisponivel: Queijo coalho" }).mensagem).toBe(
      "Produto indisponível agora: Queijo coalho.",
    );
  });

  it("repassa o campo inválido do JM422", () => {
    expect(traduzErro({ code: "JM422", message: "quantidade entre 1 e 20" }).mensagem).toBe("quantidade entre 1 e 20");
  });

  it("erro desconhecido não vaza a mensagem do banco", () => {
    expect(traduzErro({ code: "XX000", message: "relation secreta" })).toEqual({
      status: 500,
      codigo: "JM500",
      mensagem: "Erro interno.",
    });
  });
});
