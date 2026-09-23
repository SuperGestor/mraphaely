import { z } from "zod";
import { clienteDaEquipe, supabaseConfigurado } from "../models/supabase";
import { traduzErro, type ErroDeRegra } from "../errors";

/**
 * Escrita do admin por RPC, com lista FECHADA de functions.
 *
 * - Só entra o que está no mapa abaixo; qualquer outro nome é 404.
 * - Cada function tem o seu schema zod estrito (fronteira de entrada, CLAUDE.md).
 * - A regra de verdade fica no banco: a function confere papel, loja e formato de novo.
 *   O zod aqui é a primeira barreira, e não a única.
 * - Provisionar dispositivo, convidar usuário e enviar foto NÃO passam por aqui: os três
 *   geram segredo, chamam o Auth ou processam imagem no servidor, e têm rota própria.
 */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: ErroDeRegra };

const uuid = z.uuid();
const hora = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const faixa = z.strictObject({ dow: z.number().int().min(0).max(6), open: hora, close: hora });
/** Horário da loja: uma faixa por dia da semana. */
const janelaDaLoja = z.array(faixa).max(7);
/**
 * Horário do produto (JM-006): almoço E jantar nos sete dias são 14 faixas, e o teto de 7,
 * herdado do horário da loja, não deixava o caso que dá nome ao requisito caber. O PO
 * decidiu subir para 21 em 22/09/2026, com folga para um terceiro período. O banco
 * (`jm_windows_valid`) não tem teto: quem limita é este schema.
 */
const janelaDoProduto = z.array(faixa).max(21);
const textoOpcional = (max: number) => z.string().max(max).nullable();

const SCHEMAS = {
  admin_upsert_category: z.strictObject({
    p_store_id: uuid,
    p_id: uuid.nullable(),
    p_name: z.string().trim().min(1).max(40),
    p_sort_order: z.number().int().min(0).max(9999),
    p_is_active: z.boolean(),
  }),
  admin_upsert_product: z.strictObject({
    p_store_id: uuid,
    p_id: uuid.nullable(),
    p_category_id: uuid,
    p_name: z.string().trim().min(1).max(80),
    p_description: textoOpcional(280),
    p_price: z.number().min(0).max(99_999_999.99),
    p_emoji: textoOpcional(8),
    p_is_featured: z.boolean(),
    p_available_window: janelaDoProduto.nullable(),
    p_pdv_code: textoOpcional(40),
    p_sort_order: z.number().int().min(0).max(9999),
    p_is_active: z.boolean(),
  }),
  admin_upsert_option_group: z.strictObject({
    p_store_id: uuid,
    p_id: uuid.nullable(),
    p_name: z.string().trim().min(1).max(40),
    p_min_select: z.number().int().min(0).max(20),
    p_max_select: z.number().int().min(1).max(20),
  }),
  admin_upsert_option: z.strictObject({
    p_group_id: uuid,
    p_id: uuid.nullable(),
    p_name: z.string().trim().min(1).max(40),
    p_price_delta: z.number().min(0).max(99_999.99),
    p_pdv_code: textoOpcional(40),
    p_is_available: z.boolean(),
    p_sort_order: z.number().int().min(0).max(9999),
  }),
  admin_set_product_groups: z.strictObject({
    p_product_id: uuid,
    p_group_ids: z.array(uuid).max(20),
  }),
  admin_upsert_table: z.strictObject({
    p_store_id: uuid,
    p_id: uuid.nullable(),
    p_number: z.number().int().min(1).max(9999),
    p_label: textoOpcional(40),
    p_is_active: z.boolean(),
  }),
  admin_update_store_appearance: z.strictObject({
    p_store_id: uuid,
    p_primary: hex,
    p_accent: hex,
    p_logo_url: z.url().max(500).nullable(),
  }),
  admin_update_store_hours: z.strictObject({
    p_store_id: uuid,
    p_opening_hours: janelaDaLoja.nullable(),
    p_timezone: z.string().min(1).max(64),
    p_business_day_start: hora,
  }),
  staff_set_product_availability: z.strictObject({
    p_product_id: uuid,
    p_available: z.boolean(),
  }),
  // Tempo de mesa parada (JM-122): o mesmo limite do CHECK de stores, para a tela recusar
  // antes de ir ao banco. O padrão de 3 h é da coluna, e não se repete aqui.
  admin_update_store_idle_alert: z.strictObject({
    p_store_id: uuid,
    p_minutes: z.number().int().min(30).max(1440),
  }),
  // Modo de comanda da loja (JM-200) e contingência por mesa (JM-186): dono e gestor.
  admin_set_tab_mode: z.strictObject({
    p_store_id: uuid,
    p_mode: z.enum(["mesa_unica", "nomeada"]),
  }),
  staff_set_table_ordering: z.strictObject({
    p_table_id: uuid,
    p_enabled: z.boolean(),
    p_reason: z.string().trim().min(1).max(140).nullable(),
  }),
} as const;

export type FunctionDoAdmin = keyof typeof SCHEMAS;

export function ehFunctionDoAdmin(nome: string): nome is FunctionDoAdmin {
  return Object.hasOwn(SCHEMAS, nome);
}

export async function executarRpcDoAdmin(nome: string, corpo: unknown): Promise<Resultado<unknown>> {
  if (!ehFunctionDoAdmin(nome)) {
    return { ok: false, erro: { status: 404, codigo: "JM404", mensagem: "Operação inexistente." } };
  }
  if (!supabaseConfigurado()) {
    return { ok: false, erro: { status: 503, codigo: "JM503", mensagem: "Banco indisponível neste ambiente." } };
  }

  const entrada = SCHEMAS[nome].safeParse(corpo);
  if (!entrada.success) {
    const campo = entrada.error.issues[0]?.path.join(".") ?? "";
    return { ok: false, erro: { status: 422, codigo: "JM422", mensagem: `Campo inválido: ${campo}` } };
  }

  const supabase = await clienteDaEquipe();
  const { data, error } = await supabase.rpc(nome, entrada.data);
  return error ? { ok: false, erro: traduzErro(error) } : { ok: true, dados: data ?? null };
}
