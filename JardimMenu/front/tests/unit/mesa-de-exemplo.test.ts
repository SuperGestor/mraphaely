import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarMesaDeExemplo } from "@/lib/mock/mesa";
import { PedidoRecusado } from "@/lib/sacola";

/**
 * O dublê da mesa recusa com os mesmos códigos das functions do banco. Ele não prova a
 * regra (isso é o pgTAP), mas garante que a tela de exemplo exercita os mesmos caminhos.
 */
function mesa(modo: "mesa_unica" | "nomeada" = "mesa_unica", aberta = true) {
  return criarMesaDeExemplo({
    numeroDaMesa: 7,
    modoDaLoja: modo,
    lojaAberta: () => aberta,
    precificar: (item) => ({ name: "Chopp", line_total: 16 * item.quantity, options: [] }),
  });
}

const item = { product_id: "p1", quantity: 2, option_ids: [], notes: null };

function codigo(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof PedidoRecusado) return e.codigo;
    throw e;
  }
  return "sem recusa";
}

describe("mesa de exemplo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mesa única nasce com a comanda Mesa e não cria comanda com nome (JM-200)", () => {
    const m = mesa();
    const s = m.abrir();
    expect(s.tab_mode).toBe("mesa_unica");
    expect(s.tabs.map((t) => t.name)).toEqual(["Mesa"]);
    expect(codigo(() => m.criarComanda("Maria"))).toBe("JMT05");
  });

  it("nome de comanda repetido é recusado sem diferenciar caixa (JM-201, P6)", () => {
    const m = mesa("nomeada");
    m.criarComanda("Maria");
    expect(codigo(() => m.criarComanda("maria"))).toBe("JMT04");
  });

  it("mesma chave na mesma abertura devolve o mesmo pedido (JM-032)", () => {
    const m = mesa();
    const s = m.abrir();
    const envio = { session_id: s.session_id, tab_id: s.tabs[0].id, items: [item] };
    const a = m.enviar(envio, "chave-de-teste-0001");
    const b = m.enviar(envio, "chave-de-teste-0001");
    expect(b.order_id).toBe(a.order_id);
    expect(b.replayed).toBe(true);
    expect(m.resumo().total).toBe(32);
  });

  it("chave fora do formato, abertura errada e loja fechada são recusadas", () => {
    const m = mesa("mesa_unica", false);
    const s = m.abrir();
    const envio = { session_id: s.session_id, tab_id: s.tabs[0].id, items: [item] };
    expect(codigo(() => m.enviar(envio, "curta"))).toBe("JMK01");
    expect(codigo(() => m.enviar({ ...envio, session_id: "outra" }, "chave-de-teste-0002"))).toBe("JMS01");
    expect(codigo(() => m.enviar(envio, "chave-de-teste-0003"))).toBe("JMH01");
  });

  it("dois toques no cancelamento criam um pedido só, e a aprovação tira o item da conta (JM-111)", () => {
    const m = mesa();
    const s = m.abrir();
    const r = m.enviar(
      { session_id: s.session_id, tab_id: s.tabs[0].id, items: [item, { ...item, quantity: 1 }] },
      "chave-de-teste-0004",
    );
    const itemId = m.resumo().tabs[0].orders[0].items[0].id;
    m.pedirCancelamento(r.order_id, itemId);
    m.pedirCancelamento(r.order_id, itemId);
    expect(m.resumo().cancel_requests).toHaveLength(1);
    vi.advanceTimersByTime(15_000);
    const depois = m.resumo();
    expect(depois.cancel_requests[0].status).toBe("approved");
    expect(depois.tabs[0].orders[0].items.map((i) => i.id)).not.toContain(itemId);
    expect(depois.total).toBe(16);
  });

  it("chamado: dois toques dão um só, e o reforço espera 3 minutos (JM-038, JM-040)", () => {
    const m = mesa();
    const c1 = m.chamarGarcom();
    const c2 = m.chamarGarcom();
    expect(c2.call_id).toBe(c1.call_id);
    expect(codigo(() => m.reforcar(c1.call_id))).toBe("JMW01");
    vi.advanceTimersByTime(19_000);
    expect(m.resumo().waiter_call?.acknowledged_at).toBeNull();
    // O garçom de exemplo atende em 20 s; atendido, não há o que reforçar.
    vi.advanceTimersByTime(2_000);
    expect(m.resumo().waiter_call?.acknowledged_at).not.toBeNull();
    expect(codigo(() => m.reforcar(c1.call_id))).toBe("JM409");
  });
});
