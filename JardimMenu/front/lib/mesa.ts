import type { ItemSelection, Uuid } from "./types";

/**
 * O que o tablet sabe da mesa na Fase B: a abertura (JM-182), as comandas (JM-200..203),
 * os pedidos com o que foi pedido pelo tablet (JM-011), os pedidos de cancelamento
 * (JM-111) e o chamado de garçom (JM-038..040). Os formatos espelham o jsonb das functions
 * `tablet_open_session` e `tablet_session_summary`.
 */

export type ModoDeComanda = "mesa_unica" | "nomeada";

export interface ComandaAberta {
  id: Uuid;
  name: string;
}

/** tablet_open_session */
export interface SessaoDaMesa {
  session_id: Uuid;
  tab_mode: ModoDeComanda;
  tabs: ComandaAberta[];
}

export interface ItemNoResumo {
  id: Uuid;
  name: string;
  quantity: number;
  notes: string | null;
  line_total: number;
  options: string[];
}

export interface PedidoNoResumo {
  id: Uuid;
  display_number: number;
  status: "confirmed" | "preparing" | "delivered" | "cancelled";
  created_at: string;
  subtotal: number;
  items: ItemNoResumo[];
}

export interface ComandaNoResumo {
  id: Uuid;
  name: string;
  opened_at: string;
  subtotal: number;
  orders: PedidoNoResumo[];
}

export interface CancelamentoNoResumo {
  id: Uuid;
  order_id: Uuid;
  item_id: Uuid | null;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  decided_at: string | null;
}

export interface ChamadoDeGarcom {
  call_id: Uuid;
  created_at: string;
  acknowledged_at: string | null;
  reinforced_at: string | null;
  closed_at: string | null;
  /** O toque caiu dentro dos 60 s do chamado anterior e devolveu o mesmo (JM-038). */
  repeated?: boolean;
}

/** tablet_session_summary, o polling de 10 s (JM-012). */
export interface ResumoDaMesa {
  table_number: number | null;
  ordering_enabled: boolean;
  tab_mode: ModoDeComanda;
  session: { id: Uuid; opened_at: string } | null;
  tabs: ComandaNoResumo[];
  total: number;
  cancel_requests: CancelamentoNoResumo[];
  waiter_call: ChamadoDeGarcom | null;
}

/** O corpo de /api/orders: só identificadores, quantidade e observação (JM-031). */
export interface EnvioDoPedido {
  session_id: Uuid;
  tab_id: Uuid;
  items: ItemSelection[];
}

export interface PedidoEnviado {
  order_id: Uuid;
  display_number: number;
  subtotal: number;
  replayed: boolean;
}

/**
 * Recusas que dizem que a abertura ou a comanda mudou por fora (a equipe encerrou, migrou
 * ou fechou a mesa). A tela relê a mesa antes de o cliente tentar de novo.
 */
export const RECUSAS_DE_MESA = new Set(["JMS01", "JMS02", "JMS03", "JMT01", "JMT02", "JMT03"]);

/** Reforço do chamado de garçom (JM-040): só depois de 3 minutos sem atendimento. */
export const REFORCO_DEPOIS_DE_MS = 3 * 60_000;
