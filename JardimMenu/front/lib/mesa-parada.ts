/**
 * Regras puras do tempo de mesa parada (JM-122, P5), usadas pela tela de mesas do admin.
 *
 * Ficam fora do componente para o Vitest provar sem JSX, como `janela-do-produto.ts` e
 * `salao.ts`. Aqui só se lê e se rotula um número de MINUTOS: não há conta de fuso, de
 * "hoje" nem de "agora" (regra 5 do CLAUDE.md). Quem compara o relógio com este limite é
 * `mesaParada` em `salao.ts`, com o `now` que o banco mandou no retrato.
 *
 * A faixa de 30 a 1440 é a mesma em três lugares, de propósito: o CHECK
 * `stores_idle_alert_ck`, a function `admin_update_store_idle_alert` (que recusa antes,
 * com JM422) e o zod do servidor. A validação daqui não substitui nenhuma das três: ela só
 * evita a ida ao servidor e diz o limite em português.
 */

/** Mínimo aceito pelo banco. Abaixo disto o destaque apareceria em mesa recém-aberta. */
export const MINIMO_DE_MESA_PARADA = 30;
/** Máximo aceito pelo banco: 24 h. */
export const MAXIMO_DE_MESA_PARADA = 1440;
/** Padrão de `stores.idle_table_alert_minutes`: 3 h. */
export const PADRAO_DE_MESA_PARADA = 180;

/**
 * "3 h", "1 h 30 min", "45 min". É duração, e não instante: sem "há", que é o prefixo do
 * `rotuloDeTempo` da tela da equipe.
 */
export function rotuloDeDuracao(minutos: number): string {
  const inteiro = Math.trunc(minutos);
  if (inteiro < 60) return `${inteiro} min`;
  const h = Math.trunc(inteiro / 60);
  const m = inteiro % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export type LeituraDeMesaParada =
  | { ok: true; minutos: number }
  | { ok: false; problema: string };

/**
 * Lê o que a pessoa digitou no campo. Recusa vazio, texto, número quebrado e fora da
 * faixa, sempre dizendo o limite: a tela precisa explicar o "por quê", e não só negar.
 */
export function lerMinutosDeMesaParada(texto: string): LeituraDeMesaParada {
  const limpo = texto.trim();
  if (!limpo) return { ok: false, problema: "Informe o tempo em minutos." };
  if (!/^\d+$/.test(limpo)) return { ok: false, problema: "Use só números inteiros de minutos." };

  const minutos = Number(limpo);
  if (minutos < MINIMO_DE_MESA_PARADA || minutos > MAXIMO_DE_MESA_PARADA) {
    return {
      ok: false,
      problema: `O tempo vai de ${MINIMO_DE_MESA_PARADA} minutos a ${rotuloDeDuracao(MAXIMO_DE_MESA_PARADA)} (${MAXIMO_DE_MESA_PARADA} minutos).`,
    };
  }
  return { ok: true, minutos };
}
