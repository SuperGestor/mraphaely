import type { ItemSelection, ItemTotal, Menu, StoreHours, Uuid } from "./types";
import type { ChamadoDeGarcom, EnvioDoPedido, PedidoEnviado, ResumoDaMesa, SessaoDaMesa } from "./mesa";
import type { MenuSource } from "./menu-source";
import { PedidoRecusado } from "./sacola";

/**
 * Fonte real do tablet: as rotas /api/tablet/* e /api/orders, que chamam as functions do
 * banco com o hash do token. Satisfaz o mesmo contrato do exemplo, então nenhum componente
 * sabe qual das duas está ligada.
 */

/**
 * Chave do token no armazenamento local. Neutra de propósito: trocar a marca do produto
 * (A1) não pode desparear os tablets.
 */
export const CHAVE_DO_TOKEN = "jm.dt";

/**
 * Número da mesa do tablet, guardado no pareamento. Não é dado do cliente: é configuração
 * do aparelho, e serve para a tela de "chame a equipe" dizer a mesa mesmo quando o token é
 * recusado (JM-181).
 */
export const CHAVE_DA_MESA = "jm.mesa";

/** A mesa guardada no pareamento, ou nula. Nunca decide acesso: só é exibida. */
export function lerMesaGuardada(): number | null {
  try {
    const valor = typeof window === "undefined" ? null : window.localStorage.getItem(CHAVE_DA_MESA);
    return valor && /^d{1,4}$/.test(valor) ? Number(valor) : null;
  } catch {
    return null;
  }
}

/** Atualiza a mesa guardada quando o servidor informa outra (o tablet foi trocado de mesa). */
export function guardarMesa(numero: number) {
  try {
    if (window.localStorage.getItem(CHAVE_DO_TOKEN)) window.localStorage.setItem(CHAVE_DA_MESA, String(numero));
  } catch {
    // Sem armazenamento: a tela de erro fica sem o número, e o botão de garçom continua.
  }
}

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

/** Os códigos que dizem que o problema é o próprio tablet, e não o pedido. */
const CODIGOS_DO_TABLET = new Set(["JM401", "JM410", "JM423"]);

function lerToken(): string {
  let token: string | null = null;
  try {
    token = typeof window === "undefined" ? null : window.localStorage.getItem(CHAVE_DO_TOKEN);
  } catch {
    token = null;
  }
  if (!token) throw new TabletNaoPareado("JM401", "Este tablet não está pareado.");
  return token;
}

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      ...init,
      cache: "no-store",
      headers: { ...(init.headers as Record<string, string> | undefined), "x-device-token": lerToken() },
    });
  } catch (e) {
    if (e instanceof TabletNaoPareado) throw e;
    throw new PedidoRecusado("REDE", "Sem conexão com a casa. Confira o Wi-Fi ou chame o garçom.");
  }

  const corpo: unknown = await resposta.json().catch(() => null);
  if (resposta.ok) return corpo as T;

  const erro = corpo as { codigo?: string; mensagem?: string } | null;
  const codigo = erro?.codigo ?? `HTTP${resposta.status}`;
  if (CODIGOS_DO_TABLET.has(codigo)) {
    throw new TabletNaoPareado(codigo, erro?.mensagem ?? "Chame a equipe.");
  }
  throw new PedidoRecusado(codigo, erro?.mensagem ?? "Falha ao falar com o servidor.");
}

const post = (corpo?: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});

export const tabletMenuSource: MenuSource = {
  envio: "real",

  getMenu: () => chamar<Menu>("/api/tablet/cardapio"),

  getHours: () => chamar<StoreHours>("/api/tablet/horario"),

  async getItemTotal(selecao: ItemSelection): Promise<ItemTotal> {
    const r = await chamar<{ unit_total: number | string; line_total: number | string }>(
      "/api/tablet/total",
      // Só identificadores e quantidade: preço nunca sai do tablet (JM-031).
      post({ product_id: selecao.product_id, quantity: selecao.quantity, option_ids: selecao.option_ids }),
    );
    return { unit_total: Number(r.unit_total), line_total: Number(r.line_total) };
  },

  abrirMesa: () => chamar<SessaoDaMesa>("/api/tablet/abrir", { method: "POST" }),

  criarComanda: (nome: string) => chamar<{ id: Uuid; name: string; session_id: Uuid }>("/api/tablet/comanda", post({ nome })),

  async resumo(): Promise<ResumoDaMesa> {
    const r = await chamar<ResumoDaMesa>("/api/tablet/resumo");
    // numeric do Postgres chega como número no jsonb; a conversão protege o formato.
    return {
      ...r,
      total: Number(r.total),
      tabs: r.tabs.map((t) => ({
        ...t,
        subtotal: Number(t.subtotal),
        orders: t.orders.map((o) => ({
          ...o,
          subtotal: Number(o.subtotal),
          items: o.items.map((i) => ({ ...i, line_total: Number(i.line_total) })),
        })),
      })),
    };
  },

  async enviarPedido(envio: EnvioDoPedido, chave: string): Promise<PedidoEnviado> {
    const r = await chamar<PedidoEnviado>("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": chave },
      body: JSON.stringify(envio),
    });
    return { ...r, subtotal: Number(r.subtotal) };
  },

  async pedirCancelamento(orderId: Uuid, itemId: Uuid | null) {
    await chamar("/api/tablet/cancelamento", post({ order_id: orderId, item_id: itemId }));
  },

  chamarGarcom: () => chamar<ChamadoDeGarcom>("/api/tablet/garcom", { method: "POST" }),

  reforcarChamado: (callId: Uuid) => chamar<ChamadoDeGarcom>("/api/tablet/reforco", post({ call_id: callId })),

  async heartbeat(dados: { versao: string | null; bateria: number | null }) {
    await chamar("/api/tablet/heartbeat", post(dados));
  },
};
