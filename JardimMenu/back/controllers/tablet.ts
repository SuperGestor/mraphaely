import { z } from "zod";
import { clienteAnonimo, supabaseConfigurado } from "../models/supabase";
import { hashDoCabecalho } from "../services/device-token";
import { SEM_TOKEN, traduzErro, type ErroDeRegra } from "../errors";

/**
 * Controller do tablet. Recebe o header `X-Device-Token`, calcula o hash e chama a
 * function do banco, que é quem recusa (JM-100). Nesta fase o tablet só lê: pedido,
 * sessão de mesa e sacola não existem (prompt 2).
 */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: ErroDeRegra };

const SEM_BANCO: ErroDeRegra = {
  status: 503,
  codigo: "JM503",
  mensagem: "Banco indisponível neste ambiente.",
};

function preparar(headers: Headers): { hash: string } | { erro: ErroDeRegra } {
  if (!supabaseConfigurado()) return { erro: SEM_BANCO };
  const hash = hashDoCabecalho(headers);
  return hash ? { hash } : { erro: SEM_TOKEN };
}

export async function resolverDispositivo(headers: Headers): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };

  const { data, error } = await clienteAnonimo().rpc("tablet_resolve_device", { p_token_hash: p.hash });
  if (error) return { ok: false, erro: traduzErro(error) };
  return { ok: true, dados: Array.isArray(data) ? data[0] ?? null : data };
}

export async function cardapioDoTablet(headers: Headers): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };

  const { data, error } = await clienteAnonimo().rpc("tablet_menu", { p_token_hash: p.hash });
  if (error) return { ok: false, erro: traduzErro(error) };
  return { ok: true, dados: data };
}

export async function horarioDoTablet(headers: Headers): Promise<Resultado<unknown>> {
  const p = preparar(headers);
  if ("erro" in p) return { ok: false, erro: p.erro };

  const { data, error } = await clienteAnonimo().rpc("tablet_store_hours", { p_token_hash: p.hash });
  if (error) return { ok: false, erro: traduzErro(error) };
  return { ok: true, dados: Array.isArray(data) ? data[0] ?? null : data };
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
  if (!entrada.success) {
    return { ok: false, erro: { status: 422, codigo: "JM422", mensagem: "Pedido de total inválido." } };
  }

  const { data, error } = await clienteAnonimo().rpc("tablet_item_total", {
    p_token_hash: p.hash,
    p_product_id: entrada.data.product_id,
    p_quantity: entrada.data.quantity,
    p_option_ids: entrada.data.option_ids,
  });
  if (error) return { ok: false, erro: traduzErro(error) };
  return { ok: true, dados: Array.isArray(data) ? data[0] ?? null : data };
}
