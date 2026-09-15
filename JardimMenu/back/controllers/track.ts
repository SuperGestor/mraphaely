import { z } from "zod";
import { clienteAnonimo, supabaseConfigurado } from "../models/supabase";
import { registrarEAlertar } from "../services/alert";

/**
 * Ingestão do pixel (JM-061). É o único caminho de escrita anônima do sistema (regra 1).
 *
 * Duas camadas de limite, de propósito:
 * - aqui, 50 eventos por lote: o excedente nem chega ao banco;
 * - no banco (`track_events`), 50 por lote e 600 por sessão por minuto, com a sessão
 *   travada por linha.
 * Em qualquer das duas, o excedente é descartado com 202, sem erro e sem punir a sessão.
 *
 * Nenhum evento carrega dado pessoal (JM-063): o schema é estrito, e campo que não está
 * nele é recusado antes de qualquer gravação.
 */
const MAX_POR_LOTE = 50;

const Evento = z.strictObject({
  event_type: z.enum([
    "page_view",
    "category_view",
    "product_impression",
    "product_view_time",
    "product_click",
    "add_to_cart",
    "cart_open",
    "order_submitted",
    "waiter_call",
  ]),
  product_id: z.uuid().optional(),
  category_id: z.uuid().optional(),
  value_ms: z.number().int().min(0).max(600_000).optional(),
  at: z.iso.datetime(),
});

const Corpo = z.strictObject({
  session_id: z.uuid(),
  store_id: z.uuid(),
  events: z.array(Evento).min(1).max(500),
});

export type RespostaDoPixel = { status: number; corpo: Record<string, unknown> };

export async function ingerirEventos(cru: string, contentType: string | null): Promise<RespostaDoPixel> {
  let json: unknown;
  try {
    json = JSON.parse(cru);
  } catch {
    await registrarEAlertar("pixel.corpo.ilegivel", { tipo: contentType, bytes: cru.length });
    return { status: 400, corpo: { error: "corpo invalido" } };
  }

  const parsed = Corpo.safeParse(json);
  if (!parsed.success) {
    await registrarEAlertar("pixel.ingestao.invalida", {
      motivos: parsed.error.issues.map((i) => ({ campo: i.path.join("."), causa: i.code })),
    });
    return { status: 400, corpo: { error: "evento invalido" } };
  }

  const { session_id, store_id, events } = parsed.data;
  const lote = events.slice(0, MAX_POR_LOTE);
  const descartadosAqui = events.length - lote.length;

  if (!supabaseConfigurado()) {
    // Ambiente sem banco (etapa A1, ou Supabase fora do ar): aceita e descarta, sem erro
    // para o tablet. O registro deixa claro que nada foi gravado.
    await registrarEAlertar("pixel.sem_banco", { eventos: events.length }, "aviso");
    return { status: 202, corpo: { aceitos: 0, descartados: events.length, gravado: false } };
  }

  // O `at` do cliente não é gravado: o banco usa a própria hora de recebimento.
  const paraOBanco = lote.map((e) => ({
    event_type: e.event_type,
    ...(e.product_id ? { product_id: e.product_id } : {}),
    ...(e.category_id ? { category_id: e.category_id } : {}),
    ...(e.value_ms !== undefined ? { value_ms: e.value_ms } : {}),
  }));

  const { data, error } = await clienteAnonimo().rpc("track_events", {
    p_session_id: session_id,
    p_store_id: store_id,
    p_events: paraOBanco,
  });

  if (error) {
    await registrarEAlertar("pixel.ingestao.falhou", { codigo: error.code, motivo: error.message });
    // Falha do pixel nunca vira erro para o tablet: o cliente não tem o que fazer com ela.
    return { status: 202, corpo: { aceitos: 0, descartados: events.length, gravado: false } };
  }

  const linha = Array.isArray(data) ? data[0] : null;
  const aceitos = Number(linha?.aceitos ?? 0);
  const descartadosNoBanco = Number(linha?.descartados ?? 0);

  return {
    status: 202,
    corpo: { aceitos, descartados: descartadosAqui + descartadosNoBanco, gravado: true },
  };
}
