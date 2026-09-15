import type { ItemSelection, ItemTotal, Menu, StoreHours } from "./types";
import type { MenuSource } from "./menu-source";
import { PedidoRecusado } from "./sacola";

/**
 * Fonte real do cardápio no tablet: as rotas /api/tablet/*, que chamam as functions do
 * banco com o hash do token. Satisfaz o mesmo contrato do mock, então nenhum componente
 * sabe qual das duas está ligada.
 */

/**
 * Chave do token no armazenamento local. Neutra de propósito: trocar a marca do produto
 * (A1) não pode desparear os tablets.
 */
export const CHAVE_DO_TOKEN = "jm.dt";

/** Token ausente, inválido, inativo ou aposentado: a tela manda chamar a equipe (JM-181). */
export class TabletNaoPareado extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "TabletNaoPareado";
  }
}

function lerToken(): string {
  const token = typeof window === "undefined" ? null : window.localStorage.getItem(CHAVE_DO_TOKEN);
  if (!token) throw new TabletNaoPareado("JM401", "Este tablet não está pareado.");
  return token;
}

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const resposta = await fetch(caminho, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers as Record<string, string> | undefined), "x-device-token": lerToken() },
  });

  const corpo: unknown = await resposta.json().catch(() => null);
  const erro = corpo as { codigo?: string; mensagem?: string } | null;

  if (resposta.status === 401 || resposta.status === 410 || resposta.status === 423) {
    throw new TabletNaoPareado(erro?.codigo ?? "JM401", erro?.mensagem ?? "Chame a equipe.");
  }
  if (!resposta.ok) {
    throw new Error(erro?.mensagem ?? "Falha ao falar com o servidor.");
  }
  return corpo as T;
}

export const tabletMenuSource: MenuSource = {
  envio: "fase-b",

  getMenu: () => chamar<Menu>("/api/tablet/cardapio"),

  getHours: () => chamar<StoreHours>("/api/tablet/horario"),

  async getItemTotal(selecao: ItemSelection): Promise<ItemTotal> {
    const r = await chamar<{ unit_total: number | string; line_total: number | string }>("/api/tablet/total", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Só identificadores e quantidade: preço nunca sai do tablet (JM-031).
      body: JSON.stringify({
        product_id: selecao.product_id,
        quantity: selecao.quantity,
        option_ids: selecao.option_ids,
      }),
    });
    return { unit_total: Number(r.unit_total), line_total: Number(r.line_total) };
  },

  async enviarPedido(): Promise<{ numero: number }> {
    // Não existe rota de pedido antes da Fase B: /api/orders responde 404 (regra 1).
    throw new PedidoRecusado(
      "FASE_B",
      "O envio de pedido pelo tablet chega na próxima etapa. Para pedir agora, chame a equipe.",
    );
  },
};
