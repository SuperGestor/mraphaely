import { z } from "zod";
import { clienteDaEquipe, supabaseConfigurado } from "../models/supabase";
import { traduzErro, type ErroDeRegra } from "../errors";

/**
 * Tela da equipe (JM-121, D23, D30): o retrato do salão e as ações sobre ele, sob o login
 * do usuário e a RLS. Como no admin, a lista de ações é FECHADA, com schema zod estrito por
 * ação; a regra de verdade (papel, loja, estado) mora na function do banco.
 */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: ErroDeRegra };

const SEM_BANCO: ErroDeRegra = { status: 503, codigo: "JM503", mensagem: "Banco indisponível neste ambiente." };

const uuid = z.uuid();
const motivo = z.string().trim().min(1).max(140);

const ACOES = {
  atender: { fn: "staff_ack_waiter_call", schema: z.strictObject({ call_id: uuid }), params: (d: { call_id: string }) => ({ p_call_id: d.call_id }) },
  decidir: {
    fn: "staff_decide_cancel_request",
    schema: z.strictObject({ request_id: uuid, aprovar: z.boolean(), nota: z.string().trim().max(140).nullable() }),
    params: (d: { request_id: string; aprovar: boolean; nota: string | null }) => ({
      p_request_id: d.request_id,
      p_approve: d.aprovar,
      p_note: d.nota,
    }),
  },
  cancelar_pedido: {
    fn: "staff_cancel_order",
    schema: z.strictObject({ order_id: uuid, motivo }),
    params: (d: { order_id: string; motivo: string }) => ({ p_order_id: d.order_id, p_reason: d.motivo }),
  },
  remover_item: {
    fn: "staff_remove_item",
    schema: z.strictObject({ item_id: uuid, motivo }),
    params: (d: { item_id: string; motivo: string }) => ({ p_item_id: d.item_id, p_reason: d.motivo }),
  },
  encerrar_comanda: {
    fn: "staff_close_tab",
    schema: z.strictObject({ tab_id: uuid }),
    params: (d: { tab_id: string }) => ({ p_tab_id: d.tab_id }),
  },
  renomear_comanda: {
    fn: "staff_rename_tab",
    schema: z.strictObject({ tab_id: uuid, nome: z.string().trim().min(1).max(24) }),
    params: (d: { tab_id: string; nome: string }) => ({ p_tab_id: d.tab_id, p_name: d.nome }),
  },
  migrar_comanda: {
    fn: "staff_move_tab",
    schema: z.strictObject({ tab_id: uuid, mesa_id: uuid }),
    params: (d: { tab_id: string; mesa_id: string }) => ({ p_tab_id: d.tab_id, p_to_table_id: d.mesa_id }),
  },
  fechar_mesa: {
    fn: "staff_force_close_session",
    schema: z.strictObject({ session_id: uuid, motivo }),
    params: (d: { session_id: string; motivo: string }) => ({ p_session_id: d.session_id, p_reason: d.motivo }),
  },
  contingencia: {
    fn: "staff_set_table_ordering",
    schema: z.strictObject({ mesa_id: uuid, pedindo: z.boolean(), motivo: motivo.nullable() }),
    params: (d: { mesa_id: string; pedindo: boolean; motivo: string | null }) => ({
      p_table_id: d.mesa_id,
      p_enabled: d.pedindo,
      p_reason: d.motivo,
    }),
  },
} as const;

export type AcaoDaEquipe = keyof typeof ACOES;

export function ehAcaoDaEquipe(nome: string): nome is AcaoDaEquipe {
  return Object.hasOwn(ACOES, nome);
}

/** Retrato do salão (staff_floor): mesas, comandas, pedidos, chamados e cancelamentos. */
export async function salao(lojaId: string | null): Promise<Resultado<unknown>> {
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };
  if (!uuid.safeParse(lojaId).success) {
    return { ok: false, erro: { status: 422, codigo: "JM422", mensagem: "Loja inválida." } };
  }
  const supabase = await clienteDaEquipe();
  const { data, error } = await supabase.rpc("staff_floor", { p_store_id: lojaId });
  return error ? { ok: false, erro: traduzErro(error) } : { ok: true, dados: data };
}

export async function executarAcaoDaEquipe(nome: string, corpo: unknown): Promise<Resultado<unknown>> {
  if (!ehAcaoDaEquipe(nome)) {
    return { ok: false, erro: { status: 404, codigo: "JM404", mensagem: "Ação inexistente." } };
  }
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };

  const acao = ACOES[nome];
  const entrada = acao.schema.safeParse(corpo);
  if (!entrada.success) {
    const campo = entrada.error.issues[0]?.path.join(".") ?? "";
    return { ok: false, erro: { status: 422, codigo: "JM422", mensagem: `Campo inválido: ${campo}` } };
  }

  const supabase = await clienteDaEquipe();
  // O tipo de cada `params` casa com o schema da própria ação; o mapa é fechado.
  const params = (acao.params as (d: unknown) => Record<string, unknown>)(entrada.data);
  const { data, error } = await supabase.rpc(acao.fn, params);
  return error ? { ok: false, erro: traduzErro(error) } : { ok: true, dados: data ?? null };
}
