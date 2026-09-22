import type { StoreRole, Uuid } from "./types";
import type { ModoDeComanda } from "./mesa";

/**
 * O retrato do salão da tela da equipe (JM-121). Espelha o jsonb de `staff_floor`, que
 * monta tudo no banco, sob o login e o papel de quem pede.
 */

export interface OpcaoNoSalao {
  name: string;
  pdv_code: string | null;
}

export interface ItemNoSalao {
  id: Uuid;
  name: string;
  quantity: number;
  notes: string | null;
  line_total: number;
  removed_at: string | null;
  remove_reason: string | null;
  /** Código do PDV, para a equipe lançar o pedido no caixa (D24, JM-121). */
  pdv_code: string | null;
  options: OpcaoNoSalao[];
}

export interface PedidoNoSalao {
  id: Uuid;
  display_number: number;
  status: "confirmed" | "preparing" | "delivered" | "cancelled";
  created_at: string;
  subtotal: number;
  cancel_reason: string | null;
  items: ItemNoSalao[];
}

export interface ComandaNoSalao {
  id: Uuid;
  name: string;
  opened_at: string;
  subtotal: number;
  orders: PedidoNoSalao[];
}

export interface TabletNoSalao {
  id: Uuid;
  name: string;
  status: "active" | "inactive";
  last_seen_at: string | null;
  battery_level: number | null;
  app_version: string | null;
}

export interface ChamadoNoSalao {
  id: Uuid;
  created_at: string;
  acknowledged_at: string | null;
  reinforced_at: string | null;
}

export interface MesaNoSalao {
  id: Uuid;
  number: number;
  label: string | null;
  is_active: boolean;
  ordering_enabled: boolean;
  ordering_disabled_reason: string | null;
  device: TabletNoSalao | null;
  session: {
    id: Uuid;
    opened_at: string;
    /** Modo de comanda da abertura, que não muda com a loja (JM-200). */
    tab_mode: ModoDeComanda;
    last_order_at: string | null;
    tabs: ComandaNoSalao[];
  } | null;
  calls: ChamadoNoSalao[];
}

export interface CancelamentoPendente {
  id: Uuid;
  order_id: Uuid;
  item_id: Uuid | null;
  requested_at: string;
  display_number: number;
  tab_name: string;
  table_number: number;
  item_name: string | null;
  item_quantity: number | null;
}

export interface Salao {
  store: {
    id: Uuid;
    name: string;
    slug: string;
    tab_mode: ModoDeComanda;
    /** Mesa parada: minutos sem pedido até o destaque (JM-122, P5; padrão 180). */
    idle_table_alert_minutes: number;
  };
  role: StoreRole;
  /** Relógio do banco no momento do retrato: as contas de "há quanto tempo" usam ele. */
  now: string;
  tables: MesaNoSalao[];
  cancel_requests: CancelamentoPendente[];
}

/** Tablet sem contato há mais que isto aparece destacado (JM-184). */
export const SEM_CONTATO_MIN = 5;
/** Bateria abaixo disto gera aviso (JM-184). */
export const BATERIA_BAIXA = 20;

/**
 * Minutos entre dois instantes. É diferença de relógio, e não cálculo de dia ou de
 * horário de funcionamento (regra 5): nenhum fuso entra aqui.
 */
export function minutosEntre(de: string, ate: string): number {
  return Math.floor((new Date(ate).getTime() - new Date(de).getTime()) / 60_000);
}

export function rotuloDeTempo(minutos: number): string {
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `há ${h} h` : `há ${h} h ${m} min`;
}

/**
 * Mesa parada (JM-122): abertura viva sem pedido novo há mais que o limite da loja. Sem
 * pedido nenhum, conta desde a abertura. O destaque não encerra nada.
 */
export function mesaParada(mesa: MesaNoSalao, salao: Salao): boolean {
  if (!mesa.session) return false;
  const desde = mesa.session.last_order_at ?? mesa.session.opened_at;
  return minutosEntre(desde, salao.now) >= salao.store.idle_table_alert_minutes;
}

export function tabletSemContato(mesa: MesaNoSalao, salao: Salao): boolean {
  if (!mesa.device || mesa.device.status !== "active") return false;
  if (!mesa.device.last_seen_at) return true;
  return minutosEntre(mesa.device.last_seen_at, salao.now) > SEM_CONTATO_MIN;
}

export function bateriaBaixa(mesa: MesaNoSalao): boolean {
  return mesa.device?.battery_level != null && mesa.device.battery_level < BATERIA_BAIXA;
}

export function totalDaMesa(mesa: MesaNoSalao): number {
  const centavos = (mesa.session?.tabs ?? []).reduce((s, t) => s + Math.round(Number(t.subtotal) * 100), 0);
  return centavos / 100;
}

/** Dono e gestor: contingência (JM-186) e fechar mesa com comanda aberta (JM-141). */
export function ehGestor(role: StoreRole): boolean {
  return role === "owner" || role === "manager";
}

/** Os pedidos de todas as mesas, do mais novo para o mais velho, com mesa e comanda. */
export function pedidosRecentes(salao: Salao, desdeMinutos: number) {
  const lista: { mesa: MesaNoSalao; comanda: ComandaNoSalao; pedido: PedidoNoSalao }[] = [];
  for (const mesa of salao.tables) {
    for (const comanda of mesa.session?.tabs ?? []) {
      for (const pedido of comanda.orders) {
        if (minutosEntre(pedido.created_at, salao.now) <= desdeMinutos) lista.push({ mesa, comanda, pedido });
      }
    }
  }
  return lista.sort((a, b) => b.pedido.created_at.localeCompare(a.pedido.created_at));
}

/** Normaliza os numeric que chegam do jsonb. */
export function normalizarSalao(s: Salao): Salao {
  return {
    ...s,
    tables: s.tables.map((m) => ({
      ...m,
      session: m.session
        ? {
            ...m.session,
            tabs: m.session.tabs.map((t) => ({
              ...t,
              subtotal: Number(t.subtotal),
              orders: t.orders.map((o) => ({
                ...o,
                subtotal: Number(o.subtotal),
                items: o.items.map((i) => ({ ...i, line_total: Number(i.line_total) })),
              })),
            })),
          }
        : null,
    })),
  };
}
