import type { ItemSelection, ItemTotal, MenuProduct, Uuid } from "./types";

/**
 * Sacola do tablet. Vive só na memória da tela: nada vai para localStorage, cookie ou
 * servidor antes do envio, porque o tablet é compartilhado e nada do cliente anterior pode
 * ficar no aparelho (JM-183).
 *
 * O preço de cada linha vem do servidor (JM-031). A soma da sacola é feita em centavos
 * inteiros, só para exibir: o total que vale é o recálculo do banco no envio (Fase B).
 */

/** Mesmo limite da rota de total e da function do banco. */
export const QUANTIDADE_MAXIMA = 20;

/** O que o modal entrega: a escolha do cliente e o total que o servidor calculou. */
export interface EscolhaDoModal {
  quantity: number;
  option_ids: Uuid[];
  notes: string | null;
  total: ItemTotal;
}

export interface ItemDaSacola {
  /** Identificador local da linha, para editar e remover. Não vai para o servidor. */
  chave: string;
  produto: MenuProduct;
  quantity: number;
  option_ids: Uuid[];
  notes: string | null;
  /** Total da linha, calculado no servidor. Nulo enquanto recalcula. */
  total: ItemTotal | null;
  /** O servidor não devolveu o total desta linha. */
  erro: boolean;
}

/** Recusa do envio, com código estável (JM-100): loja fechada, produto esgotado etc. */
export class PedidoRecusado extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "PedidoRecusado";
  }
}

/** Mesma escolha: mesmos complementos, em qualquer ordem, e mesma observação. */
export function mesmaEscolha(
  a: { option_ids: Uuid[]; notes: string | null },
  b: { option_ids: Uuid[]; notes: string | null },
): boolean {
  if ((a.notes ?? "") !== (b.notes ?? "")) return false;
  if (a.option_ids.length !== b.option_ids.length) return false;
  const conjunto = new Set(a.option_ids);
  return b.option_ids.every((id) => conjunto.has(id));
}

/** Soma para exibir, em centavos inteiros. Nula enquanto alguma linha está sem total. */
export function somarEmCentavos(itens: Pick<ItemDaSacola, "total">[]): number | null {
  let centavos = 0;
  for (const item of itens) {
    if (!item.total) return null;
    centavos += Math.round(item.total.line_total * 100);
  }
  return centavos / 100;
}

/** Nomes dos complementos escolhidos, na ordem do cardápio. */
export function nomesDasOpcoes(item: Pick<ItemDaSacola, "produto" | "option_ids">): string[] {
  return item.produto.option_groups
    .flatMap((g) => g.options)
    .filter((o) => item.option_ids.includes(o.id))
    .map((o) => o.name);
}

/** O que sai do tablet no envio: só identificadores, quantidade e observação (JM-031). */
export function paraOEnvio(itens: ItemDaSacola[]): ItemSelection[] {
  return itens.map((i) => ({
    product_id: i.produto.id,
    quantity: i.quantity,
    option_ids: i.option_ids,
    notes: i.notes,
  }));
}

export function rotuloDeItens(quantidade: number): string {
  return quantidade === 1 ? "1 item" : `${quantidade} itens`;
}
