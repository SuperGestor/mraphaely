import type { EnvioDoPedido } from "./mesa";

/**
 * Chave de idempotência do envio (JM-032): opaca, com 128 bits, no formato que a function
 * aceita (`^[A-Za-z0-9_-]{16,128}$`).
 *
 * A chave é **da sacola**, e não do toque: enquanto o que vai ser enviado não muda, toda
 * tentativa usa a mesma chave. Assim, se a resposta se perde no Wi-Fi e o cliente toca de
 * novo, o banco devolve o pedido que já entrou, em vez de criar outro. Mudou a sacola, a
 * comanda ou a abertura da mesa, a chave é outra.
 */
export function novaChave(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** O que identifica "o mesmo envio": abertura, comanda e linhas, na ordem da sacola. */
export function assinaturaDoEnvio(envio: EnvioDoPedido): string {
  return JSON.stringify([
    envio.session_id,
    envio.tab_id,
    envio.items.map((i) => [i.product_id, i.quantity, [...i.option_ids].sort(), i.notes ?? ""]),
  ]);
}

/** Guarda a chave da última tentativa e só troca quando a assinatura muda. */
export function criarGuardaDeChave() {
  let atual: { assinatura: string; chave: string } | null = null;
  return {
    para(envio: EnvioDoPedido): string {
      const assinatura = assinaturaDoEnvio(envio);
      if (!atual || atual.assinatura !== assinatura) atual = { assinatura, chave: novaChave() };
      return atual.chave;
    },
    /** Depois do pedido aceito: o próximo envio, mesmo idêntico, é outro pedido. */
    esquecer() {
      atual = null;
    },
  };
}
