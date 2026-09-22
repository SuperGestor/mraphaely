import type { ItemSelection, Uuid } from "../types";
import type {
  CancelamentoNoResumo,
  ChamadoDeGarcom,
  ComandaNoResumo,
  EnvioDoPedido,
  ModoDeComanda,
  PedidoEnviado,
  PedidoNoResumo,
  ResumoDaMesa,
  SessaoDaMesa,
} from "../mesa";
import { PedidoRecusado } from "../sacola";

/**
 * Dublê da mesa para a fonte de exemplo: abertura, comandas, pedidos, pedido de
 * cancelamento e chamado de garçom, só na memória da aba. Recusa com os mesmos códigos do
 * banco, para a tela ser exercitada sem Supabase, mas quem decide de verdade são as
 * functions `tablet_*` (Fase B).
 *
 * Na URL de exemplo:
 * - `?comandas=1` liga o modo `nomeada` (JM-200);
 * - `?contingencia=1` põe a mesa em contingência (JM-186).
 *
 * O garçom de exemplo "atende" o chamado sozinho em 20 s, e decide o pedido de
 * cancelamento em 15 s, aprovando, para a tela mostrar os dois retornos.
 */

export interface LinhaPrecificada {
  name: string;
  line_total: number;
  options: string[];
}

export interface DependenciasDaMesa {
  numeroDaMesa: number;
  modoDaLoja: ModoDeComanda;
  lojaAberta: () => boolean;
  /** Valida e precifica a linha como o banco faria (jm_item_price), ou recusa. */
  precificar: (item: ItemSelection) => LinhaPrecificada;
}

const ATENDE_EM_MS = 20_000;
const DECIDE_EM_MS = 15_000;

const agora = () => new Date().toISOString();
const uuid = (): Uuid =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000".replace(/0/g, () => Math.floor(Math.random() * 16).toString(16));

function parametro(nome: string): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get(nome) === "1";
}

const centavos = (n: number) => Math.round(n * 100);
const somar = (valores: number[]) => valores.reduce((s, v) => s + centavos(v), 0) / 100;

export function criarMesaDeExemplo(dep: DependenciasDaMesa) {
  let sessao: { id: Uuid; opened_at: string; modo: ModoDeComanda } | null = null;
  const comandas: ComandaNoResumo[] = [];
  const cancelamentos: CancelamentoNoResumo[] = [];
  const chaves = new Map<string, PedidoEnviado>();
  let chamado: ChamadoDeGarcom | null = null;
  let proximoNumero = 1;

  const modoDaLoja = (): ModoDeComanda => (parametro("comandas") ? "nomeada" : dep.modoDaLoja);

  function abrir(): SessaoDaMesa {
    if (!sessao) {
      // Trocar o modo não afeta a abertura que já existe (JM-200).
      sessao = { id: uuid(), opened_at: agora(), modo: modoDaLoja() };
      if (sessao.modo === "mesa_unica") {
        comandas.push({ id: uuid(), name: "Mesa", opened_at: agora(), subtotal: 0, orders: [] });
      }
    }
    return { session_id: sessao.id, tab_mode: sessao.modo, tabs: comandas.map((c) => ({ id: c.id, name: c.name })) };
  }

  function recalcular(comanda: ComandaNoResumo) {
    for (const pedido of comanda.orders) pedido.subtotal = somar(pedido.items.map((i) => i.line_total));
    comanda.orders = comanda.orders.filter((p) => p.items.length > 0);
    comanda.subtotal = somar(comanda.orders.map((p) => p.subtotal));
  }

  function acharPedido(orderId: Uuid): { comanda: ComandaNoResumo; pedido: PedidoNoResumo } | null {
    for (const comanda of comandas) {
      const pedido = comanda.orders.find((p) => p.id === orderId);
      if (pedido) return { comanda, pedido };
    }
    return null;
  }

  /** Aprovação do garçom de exemplo: cancela o pedido ou remove o item, e recalcula. */
  function aprovar(pedidoDeCancelamento: CancelamentoNoResumo) {
    if (pedidoDeCancelamento.status !== "pending") return;
    const achado = acharPedido(pedidoDeCancelamento.order_id);
    pedidoDeCancelamento.status = "approved";
    pedidoDeCancelamento.decided_at = agora();
    if (!achado) return;
    if (pedidoDeCancelamento.item_id) {
      achado.pedido.items = achado.pedido.items.filter((i) => i.id !== pedidoDeCancelamento.item_id);
    } else {
      achado.pedido.items = [];
    }
    recalcular(achado.comanda);
  }

  return {
    abrir,

    criarComanda(nome: string) {
      const s = abrir();
      if (s.tab_mode !== "nomeada") throw new PedidoRecusado("JMT05", "Esta mesa não usa comanda com nome.");
      const limpo = nome.trim();
      if (limpo.length < 1 || limpo.length > 24) throw new PedidoRecusado("JM422", "O nome precisa ter de 1 a 24 letras.");
      const repetido = comandas.some((c) => c.name.toLocaleLowerCase("pt-BR") === limpo.toLocaleLowerCase("pt-BR"));
      if (repetido) throw new PedidoRecusado("JMT04", "Já existe uma comanda aberta com esse nome nesta mesa.");
      const nova: ComandaNoResumo = { id: uuid(), name: limpo, opened_at: agora(), subtotal: 0, orders: [] };
      comandas.push(nova);
      return { id: nova.id, name: nova.name, session_id: s.session_id };
    },

    resumo(): ResumoDaMesa {
      return {
        table_number: dep.numeroDaMesa,
        ordering_enabled: !parametro("contingencia"),
        tab_mode: sessao?.modo ?? modoDaLoja(),
        session: sessao ? { id: sessao.id, opened_at: sessao.opened_at } : null,
        tabs: structuredClone(comandas),
        total: somar(comandas.map((c) => c.subtotal)),
        cancel_requests: structuredClone(cancelamentos),
        // Como tablet_session_summary: o chamado atendido some 2 min depois de fechado.
        waiter_call:
          chamado && (!chamado.closed_at || Date.now() - new Date(chamado.closed_at).getTime() < 120_000)
            ? { ...chamado }
            : null,
      };
    },

    enviar(envio: EnvioDoPedido, chave: string): PedidoEnviado {
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(chave)) throw new PedidoRecusado("JMK01", "Falha no envio. Tente de novo.");
      if (!sessao || envio.session_id !== sessao.id) {
        throw new PedidoRecusado("JMS01", "A mesa foi reaberta. Confira o pedido e envie de novo.");
      }
      const repetido = chaves.get(`${sessao.id}:${chave}`);
      if (repetido) return { ...repetido, replayed: true };

      const comanda = comandas.find((c) => c.id === envio.tab_id);
      if (!comanda) throw new PedidoRecusado("JMT01", "Essa comanda foi encerrada. Escolha ou abra outra.");
      if (parametro("contingencia")) throw new PedidoRecusado("JMC01", "O pedido por esta mesa está pausado. Peça ao garçom.");
      if (!dep.lojaAberta()) {
        throw new PedidoRecusado("JMH01", "A casa está fechada agora. O pedido fica disponível no horário de funcionamento.");
      }
      if (envio.items.length < 1 || envio.items.length > 50) throw new PedidoRecusado("JM422", "A sacola está vazia.");

      // Primeiro precifica tudo: uma linha recusada não deixa pedido pela metade.
      const linhas = envio.items.map((item) => ({ item, preco: dep.precificar(item) }));
      const pedido: PedidoNoResumo = {
        id: uuid(),
        display_number: proximoNumero++,
        status: "confirmed",
        created_at: agora(),
        subtotal: 0,
        items: linhas.map(({ item, preco }) => ({
          id: uuid(),
          name: preco.name,
          quantity: item.quantity,
          notes: item.notes,
          line_total: preco.line_total,
          options: preco.options,
        })),
      };
      comanda.orders.push(pedido);
      recalcular(comanda);

      const resposta: PedidoEnviado = {
        order_id: pedido.id,
        display_number: pedido.display_number,
        subtotal: pedido.subtotal,
        replayed: false,
      };
      chaves.set(`${sessao.id}:${chave}`, resposta);
      return resposta;
    },

    pedirCancelamento(orderId: Uuid, itemId: Uuid | null) {
      const achado = acharPedido(orderId);
      if (!achado) throw new PedidoRecusado("JM409", "Esse pedido já foi cancelado.");
      if (itemId && !achado.pedido.items.some((i) => i.id === itemId)) {
        throw new PedidoRecusado("JM409", "Esse item já saiu do pedido.");
      }
      const pendente = cancelamentos.find(
        (c) => c.order_id === orderId && c.item_id === itemId && c.status === "pending",
      );
      if (pendente) return; // dois toques não criam dois pedidos (JM-111)
      const novo: CancelamentoNoResumo = {
        id: uuid(),
        order_id: orderId,
        item_id: itemId,
        status: "pending",
        requested_at: agora(),
        decided_at: null,
      };
      cancelamentos.push(novo);
      setTimeout(() => aprovar(novo), DECIDE_EM_MS);
    },

    chamarGarcom(): ChamadoDeGarcom {
      const vivo =
        chamado &&
        (chamado.closed_at === null || Date.now() - new Date(chamado.created_at).getTime() < 60_000);
      if (vivo && chamado) return { ...chamado };
      const novo: ChamadoDeGarcom = {
        call_id: uuid(),
        created_at: agora(),
        acknowledged_at: null,
        reinforced_at: null,
        closed_at: null,
      };
      chamado = novo;
      setTimeout(() => {
        if (chamado?.call_id !== novo.call_id || chamado.acknowledged_at) return;
        chamado = { ...chamado, acknowledged_at: agora(), closed_at: agora() };
      }, ATENDE_EM_MS);
      return { ...novo };
    },

    reforcar(callId: Uuid): ChamadoDeGarcom {
      if (!chamado || chamado.call_id !== callId) throw new PedidoRecusado("JM404", "Chamado não encontrado.");
      if (chamado.acknowledged_at || chamado.closed_at) throw new PedidoRecusado("JM409", "O garçom já atendeu.");
      if (!chamado.reinforced_at) {
        if (Date.now() - new Date(chamado.created_at).getTime() < 3 * 60_000) {
          throw new PedidoRecusado("JMW01", "O reforço fica disponível 3 minutos depois do chamado.");
        }
        chamado = { ...chamado, reinforced_at: agora() };
      }
      return { ...chamado };
    },
  };
}
