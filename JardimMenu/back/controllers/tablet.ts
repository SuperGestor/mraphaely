import { z } from "zod";
import { clienteAnonimo, supabaseConfigurado } from "../models/supabase";
import { hashDoCabecalho } from "../services/device-token";
import { alertarSemBloquear } from "../services/alert";
import { SEM_TOKEN, traduzErro, type ErroDeRegra } from "../errors";

/**
 * Controller do tablet. Recebe o header `X-Device-Token`, calcula o hash e chama a
 * function do banco, que é quem recusa (JM-100). O corpo passa por zod estrito antes:
 * campo que não está no contrato, como preço, é recusado aqui e ignorado no banco (JM-031).
 */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: ErroDeRegra };

const SEM_BANCO: ErroDeRegra = {
  status: 503,
  codigo: "JM503",
  mensagem: "Banco indisponível neste ambiente.",
};
const ENTRADA_INVALIDA = (mensagem = "Dados inválidos."): ErroDeRegra => ({ status: 422, codigo: "JM422", mensagem });

function preparar(headers: Headers): { hash: string } | { erro: ErroDeRegra } {
  if (!supabaseConfigurado()) {
    // NF-009: o 503 de banco ausente é 5xx como qualquer outro, e aqui ele vale por todas
    // as rotas do tablet, que é o caminho do cliente. O envio sai depois da resposta.
    alertarSemBloquear("servidor.5xx.sem_banco", { codigo: SEM_BANCO.codigo, status: SEM_BANCO.status });
    return { erro: SEM_BANCO };
  }
  const hash = hashDoCabecalho(headers);
  return hash ? { hash } : { erro: SEM_TOKEN };
}

/** Uma linha só, para as functions que devolvem `returns table`. */
const primeira = (data: unknown) => (Array.isArray(data) ? data[0] ?? null : data);

async function chamar(fn: string, params: Record<string, unknown>, umaLinha = false): Promise<Resultado<unknown>> {
  const { data, error } = await clienteAnonimo().rpc(fn, params);
  if (error) return { ok: false, erro: traduzErro(error) };
  return { ok: true, dados: umaLinha ? primeira(data) : data };
}

// ------------------------------------------------------------------ leitura (Fase A)

export async function resolverDispositivo(headers: Headers): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };
  return chamar("tablet_resolve_device", { p_token_hash: p.hash }, true);
}

export async function cardapioDoTablet(headers: Headers): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };
  return chamar("tablet_menu", { p_token_hash: p.hash });
}

export async function horarioDoTablet(headers: Headers): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };
  return chamar("tablet_store_hours", { p_token_hash: p.hash }, true);
}

/** Só identificadores e quantidade. Preço no corpo não existe no contrato (JM-031). */
const CorpoDoTotal = z.strictObject({
  product_id: z.uuid(),
  quantity: z.number().int().min(1).max(20),
  option_ids: z.array(z.uuid()).max(50),
});

export async function totalDoItem(headers: Headers, corpo: unknown): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };

  const entrada = CorpoDoTotal.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA("Pedido de total inválido.") };

  return chamar(
    "tablet_item_total",
    {
      p_token_hash: p.hash,
      p_product_id: entrada.data.product_id,
      p_quantity: entrada.data.quantity,
      p_option_ids: entrada.data.option_ids,
    },
    true,
  );
}

// ------------------------------------------------------------------ Fase B

/** Primeiro toque no cardápio: abre a abertura da mesa, ou devolve a que existe (JM-182). */
export async function abrirMesa(headers: Headers): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };
  return chamar("tablet_open_session", { p_token_hash: p.hash });
}

const CorpoDaComanda = z.strictObject({ nome: z.string().trim().min(1).max(24) });

/** Comanda com nome, no modo nomeada (JM-201). */
export async function criarComanda(headers: Headers, corpo: unknown): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };
  const entrada = CorpoDaComanda.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA("O nome da comanda tem de 1 a 24 caracteres.") };
  return chamar("tablet_create_tab", { p_token_hash: p.hash, p_name: entrada.data.nome });
}

/** O mesmo formato que o banco exige: gerada pelo tablet, opaca, de 16 a 128 caracteres. */
const CHAVE_DE_IDEMPOTENCIA = /^[A-Za-z0-9_-]{16,128}$/;

const ItemDoPedido = z.strictObject({
  product_id: z.uuid(),
  quantity: z.number().int().min(1).max(20),
  option_ids: z.array(z.uuid()).max(50),
  notes: z.string().max(140).nullable(),
});

const CorpoDoPedido = z.strictObject({
  session_id: z.uuid(),
  tab_id: z.uuid(),
  items: z.array(ItemDoPedido).min(1).max(50),
});

/**
 * Envio do pedido (JM-031, JM-032, JM-100). O `Idempotency-Key` é obrigatório; sem ele, a
 * recusa já sai aqui, e o banco confere de novo.
 *
 * NF-009, Fase B: falha de criação de pedido é o único aviso de pedido perdido durante o
 * piloto, então ela tem evento próprio, e não se mistura com o 5xx genérico. O alerta é
 * por falha nossa (recusa 5xx ou exceção); recusa de regra (mesa encerrada, casa fechada,
 * produto indisponível) é resposta esperada do JM-100, e não acorda ninguém.
 *
 * O alerta não leva token, corpo do pedido nem nome de comanda: quem lê o canal precisa
 * saber que um pedido caiu e ir até as mesas, não saber quem pediu o quê.
 */
export async function enviarPedido(headers: Headers, corpo: unknown): Promise<Resultado<unknown>> {
  let r: Resultado<unknown>;
  try {
    r = await pedidoDoTablet(headers, corpo);
  } catch (e) {
    // Rede com o Supabase fora, por exemplo. O erro continua subindo, como antes: quem
    // responde é o Next, e o onRequestError registra o 5xx da rota. Aqui só entra o aviso
    // de pedido perdido, que ninguém mais dá.
    alertarSemBloquear("pedido.criacao.falhou", {
      status: 500,
      erro: e instanceof Error ? e.name : "desconhecida",
    });
    throw e;
  }

  if (!r.ok && r.erro.status >= 500) {
    alertarSemBloquear("pedido.criacao.falhou", { codigo: r.erro.codigo, status: r.erro.status });
  }
  return r;
}

async function pedidoDoTablet(headers: Headers, corpo: unknown): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };

  const chave = headers.get("idempotency-key");
  if (!chave || !CHAVE_DE_IDEMPOTENCIA.test(chave)) {
    return {
      ok: false,
      erro: { status: 428, codigo: "JMK01", mensagem: "O envio chegou sem identificação. Toque em confirmar de novo." },
    };
  }

  const entrada = CorpoDoPedido.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA("Pedido em formato inválido.") };

  return chamar("tablet_place_order", {
    p_token_hash: p.hash,
    p_session_id: entrada.data.session_id,
    p_tab_id: entrada.data.tab_id,
    p_idempotency_key: chave,
    p_items: entrada.data.items,
  });
}

const CorpoDoCancelamento = z.strictObject({ order_id: z.uuid(), item_id: z.uuid().nullable() });

/** O cliente pede o cancelamento; quem decide é a equipe (JM-111, D28). */
export async function pedirCancelamento(headers: Headers, corpo: unknown): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };
  const entrada = CorpoDoCancelamento.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA() };
  return chamar("tablet_request_cancel", {
    p_token_hash: p.hash,
    p_order_id: entrada.data.order_id,
    p_item_id: entrada.data.item_id,
  });
}

/**
 * Chamado de garçom (JM-038, JM-187). Caminho próprio, sem passar por nada do pedido: ele
 * precisa funcionar quando o pedido não funciona.
 */
export async function chamarGarcom(headers: Headers): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };
  return chamar("tablet_call_waiter", { p_token_hash: p.hash });
}

const CorpoDoReforco = z.strictObject({ call_id: z.uuid() });

export async function reforcarChamado(headers: Headers, corpo: unknown): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };
  const entrada = CorpoDoReforco.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA() };
  return chamar("tablet_reinforce_call", { p_token_hash: p.hash, p_call_id: entrada.data.call_id });
}

/** O que foi pedido pela mesa, para o polling de 10 s (JM-011, JM-012). */
export async function resumoDaMesa(headers: Headers): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };
  return chamar("tablet_session_summary", { p_token_hash: p.hash });
}

const CorpoDoHeartbeat = z.strictObject({
  versao: z.string().trim().min(1).max(40).nullable(),
  bateria: z.number().int().min(0).max(100).nullable(),
});

/** Último contato, versão e bateria (JM-184). */
export async function heartbeat(headers: Headers, corpo: unknown): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };
  const entrada = CorpoDoHeartbeat.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA() };
  const r = await chamar("device_heartbeat", {
    p_token_hash: p.hash,
    p_app_version: entrada.data.versao,
    p_battery: entrada.data.bateria,
  });
  return r.ok ? { ok: true, dados: { ok: true } } : r;
}
