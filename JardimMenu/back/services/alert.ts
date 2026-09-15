
/**
 * NF-009: falha na ingestão do pixel e 5xx de qualquer rota geram registro consultável
 * e alerta em canal nomeado.
 *
 * - O registro é uma linha JSON no log do servidor, com o motivo e nunca o conteúdo da
 *   requisição, para o log não virar depósito de dado do cliente.
 * - O alerta vai para `ALERT_WEBHOOK_URL` (decisão de 14/09/2026). O corpo leva `text` e
 *   `content`, então a mesma URL funciona com Slack, Google Chat e Discord.
 * - No máximo um alerta por minuto por evento: uma falha em rajada não afoga o canal.
 * - Alerta nunca derruba a rota: falha de envio é engolida.
 */
type Nivel = "erro" | "aviso";

const ultimoAlerta = new Map<string, number>();
const JANELA_MS = 60_000;

export async function registrarEAlertar(
  evento: string,
  detalhe: Record<string, unknown> = {},
  nivel: Nivel = "erro",
): Promise<void> {
  const linha = { quando: new Date().toISOString(), nivel, evento, ...detalhe };
  console.error(JSON.stringify(linha));

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  const agora = Date.now();
  if (agora - (ultimoAlerta.get(evento) ?? 0) < JANELA_MS) return;
  ultimoAlerta.set(evento, agora);

  const texto = `[Jardim Menu] ${nivel}: ${evento}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: texto, content: texto, detalhe: linha }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // O canal de alerta fora do ar não pode virar mais um erro para o cliente.
  }
}
