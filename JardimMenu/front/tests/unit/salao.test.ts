import { describe, expect, it } from "vitest";
import {
  bateriaBaixa,
  mesaParada,
  minutosEntre,
  pedidosRecentes,
  rotuloDeTempo,
  tabletSemContato,
  totalDaMesa,
  type MesaNoSalao,
  type PedidoNoSalao,
  type Salao,
} from "@/lib/salao";

const AGORA = "2026-09-21T22:00:00.000Z";
const antes = (min: number) => new Date(new Date(AGORA).getTime() - min * 60_000).toISOString();

const TABLET = { id: "d1", name: "T1", status: "active" as const, last_seen_at: antes(1), battery_level: 80, app_version: "0.1.0" };

function mesa(over: Partial<MesaNoSalao> = {}): MesaNoSalao {
  return {
    id: "m1",
    number: 1,
    label: null,
    is_active: true,
    ordering_enabled: true,
    ordering_disabled_reason: null,
    device: TABLET,
    session: null,
    calls: [],
    ...over,
  };
}

function salao(tables: MesaNoSalao[]): Salao {
  return {
    store: { id: "s", name: "Loja", slug: "loja", tab_mode: "mesa_unica", idle_table_alert_minutes: 180 },
    role: "waiter",
    now: AGORA,
    tables,
    cancel_requests: [],
  };
}

function sessao(abertaHa: number, ultimoPedidoHa: number | null, subtotais: number[] = [], orders: PedidoNoSalao[] = []) {
  return {
    id: "ses",
    opened_at: antes(abertaHa),
    tab_mode: "mesa_unica" as const,
    last_order_at: ultimoPedidoHa === null ? null : antes(ultimoPedidoHa),
    tabs: subtotais.map((v, i) => ({ id: `t${i}`, name: "Mesa", opened_at: antes(abertaHa), subtotal: v, orders })),
  };
}

describe("regras do salão", () => {
  it("minutos entre dois instantes, sem fuso", () => {
    expect(minutosEntre(antes(90), AGORA)).toBe(90);
    expect(rotuloDeTempo(0)).toBe("agora");
    expect(rotuloDeTempo(45)).toBe("há 45 min");
    expect(rotuloDeTempo(120)).toBe("há 2 h");
    expect(rotuloDeTempo(135)).toBe("há 2 h 15 min");
  });

  it("mesa parada depois do limite da loja, contando do último pedido (JM-122)", () => {
    expect(mesaParada(mesa({ session: sessao(300, 179) }), salao([]))).toBe(false);
    expect(mesaParada(mesa({ session: sessao(300, 181) }), salao([]))).toBe(true);
    // Sem pedido nenhum, conta desde a abertura.
    expect(mesaParada(mesa({ session: sessao(200, null) }), salao([]))).toBe(true);
    expect(mesaParada(mesa(), salao([]))).toBe(false);
  });

  it("tablet sem contato há mais de 5 min e bateria abaixo de 20% (JM-184)", () => {
    const s = salao([]);
    expect(tabletSemContato(mesa(), s)).toBe(false);
    expect(tabletSemContato(mesa({ device: { ...TABLET, last_seen_at: antes(6) } }), s)).toBe(true);
    expect(tabletSemContato(mesa({ device: { ...TABLET, last_seen_at: null } }), s)).toBe(true);
    // Tablet desativado não é cobrado de contato.
    expect(tabletSemContato(mesa({ device: { ...TABLET, status: "inactive", last_seen_at: antes(60) } }), s)).toBe(false);
    expect(bateriaBaixa(mesa({ device: { ...TABLET, battery_level: 19 } }))).toBe(true);
    expect(bateriaBaixa(mesa({ device: { ...TABLET, battery_level: 20 } }))).toBe(false);
  });

  it("total da mesa em centavos inteiros", () => {
    expect(totalDaMesa(mesa({ session: sessao(10, 5, [0.1, 0.2]) }))).toBe(0.3);
  });

  it("pedidos recentes, do mais novo para o mais velho", () => {
    const pedido = (id: string, ha: number): PedidoNoSalao => ({
      id,
      display_number: 1,
      status: "confirmed",
      created_at: antes(ha),
      subtotal: 10,
      cancel_reason: null,
      items: [],
    });
    const m = mesa({ session: sessao(60, 1, [30], [pedido("a", 30), pedido("b", 1), pedido("c", 10)]) });
    expect(pedidosRecentes(salao([m]), 20).map((p) => p.pedido.id)).toEqual(["b", "c"]);
  });
});
