import type { Uuid } from "../types";
import type { ComandaNoSalao, ItemNoSalao, MesaNoSalao, PedidoNoSalao, Salao } from "../salao";
import type { AcaoDaEquipe, EquipeSource } from "../equipe-source";
import { FalhaDoAdmin } from "../admin-source";

/**
 * Salão de exemplo da tela da equipe: seis mesas cobrindo os casos que a tela destaca
 * (chamado aberto, pedido de cancelamento, mesa parada, tablet sem contato, bateria baixa,
 * contingência e mesa sem tablet). As ações mexem só na memória da aba; a regra de verdade
 * é das functions `staff_*`.
 */

const LOJA: Uuid = "11111111-1111-4111-8111-111111111111";
let seq = 0;
const novoId = (): Uuid => `22222222-2222-4222-8222-${String(++seq).padStart(12, "0")}`;
const haMin = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function item(name: string, quantity: number, preco: number, pdv: string, extra: Partial<ItemNoSalao> = {}): ItemNoSalao {
  return {
    id: novoId(),
    name,
    quantity,
    notes: null,
    line_total: Math.round(preco * quantity * 100) / 100,
    removed_at: null,
    remove_reason: null,
    pdv_code: pdv,
    options: [],
    ...extra,
  };
}

let numero = 0;
function pedido(min: number, items: ItemNoSalao[]): PedidoNoSalao {
  return {
    id: novoId(),
    display_number: ++numero,
    status: "confirmed",
    created_at: haMin(min),
    subtotal: somar(items),
    cancel_reason: null,
    items,
  };
}

function somar(items: ItemNoSalao[]): number {
  return items.filter((i) => !i.removed_at).reduce((s, i) => s + Math.round(i.line_total * 100), 0) / 100;
}

function comanda(name: string, min: number, orders: PedidoNoSalao[]): ComandaNoSalao {
  return { id: novoId(), name, opened_at: haMin(min), subtotal: 0, orders };
}

function mesa(number: number, extra: Partial<MesaNoSalao> = {}): MesaNoSalao {
  return {
    id: novoId(),
    number,
    label: null,
    is_active: true,
    ordering_enabled: true,
    ordering_disabled_reason: null,
    device: { id: novoId(), name: `Tablet ${number}`, status: "active", last_seen_at: haMin(0), battery_level: 78, app_version: "0.1.0" },
    session: null,
    calls: [],
    ...extra,
  };
}

function montar(): Salao {
  const m1 = mesa(1, {
    session: {
      id: novoId(),
      opened_at: haMin(52),
      tab_mode: "mesa_unica",
      last_order_at: null,
      tabs: [
        comanda("Mesa", 52, [
          pedido(48, [
            item("Chopp Pilsen da casa", 2, 16, "PDV-301", { options: [{ name: "500 ml", pdv_code: "PDV-301-G" }] }),
            item("Bolinho de mandioca", 1, 32, "PDV-102"),
          ]),
          pedido(3, [
            item("Burger do jardim", 1, 54, "PDV-401", {
              notes: "Sem cebola",
              options: [
                { name: "Ao ponto", pdv_code: null },
                { name: "Bacon", pdv_code: "PDV-901" },
              ],
            }),
          ]),
        ]),
      ],
    },
    calls: [{ id: novoId(), created_at: haMin(1), acknowledged_at: null, reinforced_at: null }],
  });

  const pedidoDaMaria = pedido(9, [item("Gin da horta", 1, 39, "PDV-501"), item("Azeitonas marinadas", 1, 18, "PDV-103")]);
  const m3 = mesa(3, {
    session: {
      id: novoId(),
      opened_at: haMin(40),
      tab_mode: "nomeada",
      last_order_at: null,
      tabs: [comanda("Maria", 40, [pedidoDaMaria]), comanda("João", 30, [pedido(25, [item("Chopp IPA", 1, 19, "PDV-302")])])],
    },
  });

  const m4 = mesa(4, {
    device: { id: novoId(), name: "Tablet 4", status: "active", last_seen_at: haMin(12), battery_level: 14, app_version: "0.1.0" },
    session: {
      id: novoId(),
      opened_at: haMin(230),
      tab_mode: "mesa_unica",
      last_order_at: null,
      tabs: [comanda("Mesa", 230, [pedido(215, [item("Ancho na brasa", 1, 92, "PDV-201")])])],
    },
  });

  const m5 = mesa(5, { ordering_enabled: false, ordering_disabled_reason: "Tablet trincado" });
  const m6 = mesa(6, { device: null });

  const tables = [m1, mesa(2), m3, m4, m5, m6];
  for (const t of tables) atualizar(t);

  return {
    store: { id: LOJA, name: "Jardim Secreto", slug: "jardim-secreto", tab_mode: "mesa_unica", idle_table_alert_minutes: 180 },
    role: "owner",
    now: new Date().toISOString(),
    tables,
    cancel_requests: [
      {
        id: novoId(),
        order_id: pedidoDaMaria.id,
        item_id: pedidoDaMaria.items[1].id,
        requested_at: haMin(2),
        display_number: pedidoDaMaria.display_number,
        tab_name: "Maria",
        table_number: 3,
        item_name: "Azeitonas marinadas",
        item_quantity: 1,
      },
    ],
  };
}

/** Recalcula subtotais e o último pedido, como o banco faria. */
function atualizar(m: MesaNoSalao) {
  if (!m.session) return;
  let ultimo: string | null = null;
  for (const t of m.session.tabs) {
    for (const o of t.orders) {
      o.subtotal = o.status === "cancelled" ? o.subtotal : somar(o.items);
      if (!ultimo || o.created_at > ultimo) ultimo = o.created_at;
    }
    t.subtotal = t.orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + Math.round(o.subtotal * 100), 0) / 100;
  }
  m.session.last_order_at = ultimo;
}

let salao: Salao | null = null;
const estado = () => (salao ??= montar());

function acharPedido(id: Uuid) {
  for (const m of estado().tables) {
    for (const t of m.session?.tabs ?? []) {
      const o = t.orders.find((p) => p.id === id);
      if (o) return { m, t, o };
    }
  }
  throw new FalhaDoAdmin(404, "JM404", "Pedido não encontrado.");
}

function acharComanda(id: Uuid) {
  for (const m of estado().tables) {
    const t = m.session?.tabs.find((c) => c.id === id);
    if (t) return { m, t };
  }
  throw new FalhaDoAdmin(404, "JMT01", "Comanda não encontrada.");
}

function fecharSeVazia(m: MesaNoSalao) {
  if (m.session && m.session.tabs.length === 0) m.session = null;
}

function executar(a: AcaoDaEquipe): unknown {
  const s = estado();
  switch (a.acao) {
    case "atender": {
      for (const m of s.tables) m.calls = m.calls.filter((c) => c.id !== a.corpo.call_id);
      return null;
    }
    case "decidir": {
      const req = s.cancel_requests.find((r) => r.id === a.corpo.request_id);
      if (!req) throw new FalhaDoAdmin(409, "JM409", "Esse pedido de cancelamento já foi decidido.");
      s.cancel_requests = s.cancel_requests.filter((r) => r.id !== req.id);
      if (a.corpo.aprovar) {
        const { m, o } = acharPedido(req.order_id);
        const agora = new Date().toISOString();
        if (req.item_id) {
          const i = o.items.find((x) => x.id === req.item_id);
          if (i) Object.assign(i, { removed_at: agora, remove_reason: "Pedido do cliente no tablet" });
          if (o.items.every((x) => x.removed_at)) Object.assign(o, { status: "cancelled", cancel_reason: "Todos os itens removidos" });
        } else {
          Object.assign(o, { status: "cancelled", cancel_reason: "Pedido do cliente no tablet" });
        }
        atualizar(m);
      }
      return null;
    }
    case "cancelar_pedido": {
      const { m, o } = acharPedido(a.corpo.order_id);
      if (o.status === "cancelled") throw new FalhaDoAdmin(409, "JM409", "Esse pedido já foi cancelado.");
      Object.assign(o, { status: "cancelled", cancel_reason: a.corpo.motivo });
      atualizar(m);
      return null;
    }
    case "remover_item": {
      for (const m of s.tables) {
        for (const t of m.session?.tabs ?? []) {
          for (const o of t.orders) {
            const i = o.items.find((x) => x.id === a.corpo.item_id);
            if (!i) continue;
            Object.assign(i, { removed_at: new Date().toISOString(), remove_reason: a.corpo.motivo });
            if (o.items.every((x) => x.removed_at)) Object.assign(o, { status: "cancelled", cancel_reason: "Todos os itens removidos" });
            atualizar(m);
            return null;
          }
        }
      }
      throw new FalhaDoAdmin(404, "JM404", "Item não encontrado.");
    }
    case "encerrar_comanda": {
      const { m, t } = acharComanda(a.corpo.tab_id);
      m.session!.tabs = m.session!.tabs.filter((c) => c.id !== t.id);
      fecharSeVazia(m);
      return { session_closed: m.session === null };
    }
    case "renomear_comanda": {
      const { m, t } = acharComanda(a.corpo.tab_id);
      if (m.session!.tabs.some((c) => c.id !== t.id && c.name.toLowerCase() === a.corpo.nome.toLowerCase())) {
        throw new FalhaDoAdmin(409, "JMT04", "Já existe uma comanda aberta com esse nome nesta mesa.");
      }
      t.name = a.corpo.nome;
      return null;
    }
    case "migrar_comanda": {
      const { m, t } = acharComanda(a.corpo.tab_id);
      const destino = s.tables.find((x) => x.id === a.corpo.mesa_id);
      if (!destino || destino.id === m.id) throw new FalhaDoAdmin(422, "JM422", "Escolha outra mesa.");
      destino.session ??= { id: novoId(), opened_at: new Date().toISOString(), tab_mode: s.store.tab_mode, last_order_at: null, tabs: [] };
      if (destino.session.tabs.some((c) => c.name.toLowerCase() === t.name.toLowerCase())) {
        throw new FalhaDoAdmin(409, "JMT04", "Já existe uma comanda aberta com esse nome na mesa de destino.");
      }
      m.session!.tabs = m.session!.tabs.filter((c) => c.id !== t.id);
      destino.session.tabs.push(t);
      atualizar(destino);
      fecharSeVazia(m);
      if (m.session) atualizar(m);
      return { origin_closed: m.session === null };
    }
    case "fechar_mesa": {
      const m = s.tables.find((x) => x.session?.id === a.corpo.session_id);
      if (!m) throw new FalhaDoAdmin(409, "JMS02", "Essa mesa já foi fechada.");
      m.session = null;
      s.cancel_requests = s.cancel_requests.filter((r) => r.table_number !== m.number);
      return null;
    }
    case "contingencia": {
      const m = s.tables.find((x) => x.id === a.corpo.mesa_id);
      if (!m) throw new FalhaDoAdmin(404, "JM404", "Mesa não encontrada.");
      m.ordering_enabled = a.corpo.pedindo;
      m.ordering_disabled_reason = a.corpo.pedindo ? null : a.corpo.motivo;
      return null;
    }
  }
}

export const equipeDeExemplo: EquipeSource = {
  modo: "exemplo",

  async contexto() {
    return { email: null, lojas: [{ store_id: LOJA, role: "owner", nome: "Jardim Secreto", slug: "jardim-secreto" }] };
  },

  async salao() {
    const s = estado();
    s.now = new Date().toISOString();
    return structuredClone(s);
  },

  async executar(a) {
    return executar(a);
  },

  assinar(_lojaId, _aoMudar, aoEstado) {
    // Sem Realtime no exemplo: a tela relê depois de cada ação e no intervalo de segurança.
    aoEstado(false);
    return () => {};
  },
};
