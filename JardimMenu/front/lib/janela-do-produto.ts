import { z } from "zod";
import type { TimeWindow } from "./types";

/**
 * Regras puras do horário do produto (JM-006, "almoço x jantar"), usadas pelo editor do
 * admin (components/admin/EditorDeJanela.tsx). Ficam fora do componente para o Vitest
 * provar sem JSX, como `sacola.ts` e `salao.ts`.
 *
 * Aqui só se MONTA e se confere a lista de faixas, em hora local da loja. Quem decide se o
 * produto aparece agora é o banco, com `jm_windows_open` no fuso da loja (regra 5 do
 * CLAUDE.md, D12): não há conta de fuso, de "hoje" nem de "agora". A validação de verdade
 * também é do banco (`jm_windows_valid`, dentro de `admin_upsert_product`) e do zod do
 * servidor (back/controllers/admin-rpc.ts); a daqui repete as mesmas regras só para
 * apontar a faixa errada antes de ir ao servidor.
 */

/** 0 = domingo, como em `TimeWindow.dow` e na tela de horário da loja. */
export const DIAS_DA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

/**
 * Espelha o `.max(7)` do schema `janela` em back/controllers/admin-rpc.ts, que é o mesmo
 * do horário da loja. O banco (`jm_windows_valid`) não tem teto; quem recusa a oitava
 * faixa é o zod do servidor, e o editor não deixa chegar lá.
 */
export const MAXIMO_DE_FAIXAS = 7;

/** Mesma expressão de `jm_windows_valid` e do zod do servidor: "HH:MM", de 00:00 a 23:59. */
const HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const faixaSchema = z.strictObject({
  dow: z.number().int().min(0).max(6),
  open: z.string().regex(HORA),
  close: z.string().regex(HORA),
});

/**
 * Leitura do que veio do banco. O `jm_windows_valid` aceita `dow` como número ou como
 * texto ("3"), e aceita chaves a mais; o zod do servidor, na volta, exige número e objeto
 * estrito. Por isso a leitura converte o dia e descarta o resto. A hora é lida como veio,
 * mesmo errada: o editor aponta a faixa em vez de apagá-la.
 */
const janelaLida = z.array(
  z.object({
    dow: z.preprocess(
      (v) => (typeof v === "string" && /^[0-6]$/.test(v) ? Number(v) : v),
      z.number().int().min(0).max(6),
    ),
    open: z.string(),
    close: z.string(),
  }),
);

/**
 * Janela gravada, pronta para o editor. Um formato que a function nunca gravaria (só
 * entra por SQL direto) vira lista vazia, e NÃO nulo: nulo seria "sempre disponível", o
 * contrário do que o gestor configurou. Lista vazia bloqueia a gravação até ele refazer
 * as faixas (ver `problemasDaJanela`).
 *
 * As faixas abrem em ordem de dia (domingo primeiro, como a tabela do horário da loja) e
 * de abertura. A ordem não muda o sentido: `jm_windows_open` aceita se QUALQUER faixa
 * estiver aberta. Só a leitura ordena; durante a edição a lista fica como o gestor montou,
 * para a faixa não pular de lugar enquanto ele digita.
 */
export function lerJanela(valor: unknown): TimeWindow[] | null {
  if (valor === null || valor === undefined) return null;
  const lida = janelaLida.safeParse(valor);
  if (!lida.success) return [];
  return [...lida.data].sort((a, b) => a.dow - b.dow || a.open.localeCompare(b.open));
}

/**
 * Atalhos de faixas típicas, sempre editáveis depois. Os horários são sugestão de tela,
 * não regra: o gestor ajusta cada faixa ao horário da casa.
 *
 * Preenchem os sete dias porque é mais rápido tirar o domingo do que acrescentar cinco
 * dias úteis; e SUBSTITUEM a lista, porque almoço e jantar juntos nos sete dias passariam
 * do teto de 7 faixas.
 */
export const ATALHOS = {
  almoco: { rotulo: "Almoço", open: "11:30", close: "15:00" },
  jantar: { rotulo: "Jantar", open: "18:00", close: "23:00" },
} as const;

export type Atalho = keyof typeof ATALHOS;

export function faixasDoAtalho(atalho: Atalho): TimeWindow[] {
  const { open, close } = ATALHOS[atalho];
  return DIAS_DA_SEMANA.map((_, dow) => ({ dow, open, close }));
}

/**
 * Faixa nova: repete o horário da última (quem monta almoço de segunda a sexta digita a
 * hora uma vez só) e pega o primeiro dia ainda sem faixa, de segunda a domingo. Não há
 * conta de calendário: é só escolher um valor inicial para o seletor de dia.
 */
export function novaFaixa(faixas: TimeWindow[]): TimeWindow {
  const ultima = faixas.length ? faixas[faixas.length - 1] : null;
  const usados = new Set(faixas.map((f) => f.dow));
  const livre = [1, 2, 3, 4, 5, 6, 0].find((dow) => !usados.has(dow));
  return {
    dow: livre ?? ultima?.dow ?? 1,
    open: ultima?.open ?? ATALHOS.almoco.open,
    close: ultima?.close ?? ATALHOS.almoco.close,
  };
}

/**
 * Fechamento menor que a abertura cruza a meia-noite: sexta das 18:00 às 02:00 vale até
 * as 02:00 de sábado, como no horário da loja. É só o aviso da tela, com a mesma
 * comparação de texto "HH:MM" que a tela de horário da loja faz (com zero à esquerda, é a
 * ordem do relógio); quem aplica a regra é `jm_windows_open`, no banco.
 */
export function cruzaAMeiaNoite(faixa: TimeWindow): boolean {
  return HORA.test(faixa.open) && HORA.test(faixa.close) && faixa.close < faixa.open;
}

export interface ProblemasDaJanela {
  /** Problema da lista inteira: vazia, ou acima do teto. */
  geral: string | null;
  /** Um por faixa, na mesma ordem da lista; nulo quando a faixa está certa. */
  faixas: (string | null)[];
}

function problemaDaFaixa(faixa: TimeWindow): string | null {
  const lida = faixaSchema.safeParse(faixa);
  if (!lida.success) {
    const campo = lida.error.issues[0]?.path[0];
    if (campo === "dow") return "Escolha o dia da semana.";
    if (campo === "open") return "Informe a abertura, no formato HH:MM.";
    if (campo === "close") return "Informe o fechamento, no formato HH:MM.";
    return "Faixa em formato inválido.";
  }
  // O banco recusa abertura igual ao fechamento (jm_windows_valid): a faixa não teria
  // nenhum minuto, nem cruzando a meia-noite.
  if (faixa.open === faixa.close) return "Abertura e fechamento iguais: a faixa ficaria sem nenhum minuto.";
  return null;
}

export function problemasDaJanela(valor: TimeWindow[] | null): ProblemasDaJanela {
  if (valor === null) return { geral: null, faixas: [] };
  let geral: string | null = null;
  if (valor.length === 0) {
    // Comportamento conservador, pendente de decisão do dono do produto: o banco aceita
    // lista vazia, mas `jm_windows_open` nunca a considera aberta, e o produto sumiria do
    // cardápio em qualquer horário, sem aviso. Para tirar o produto do ar já existem
    // "Ativo" e a disponibilidade do dia (JM-004); aqui a gravação é bloqueada.
    geral = "Sem nenhuma faixa, o produto não apareceria em horário nenhum. Adicione uma faixa ou volte para sempre disponível.";
  } else if (valor.length > MAXIMO_DE_FAIXAS) {
    const excesso = valor.length - MAXIMO_DE_FAIXAS;
    geral = `No máximo ${MAXIMO_DE_FAIXAS} faixas. Remova ${excesso} para gravar.`;
  }
  return { geral, faixas: valor.map(problemaDaFaixa) };
}

/** A primeira coisa a corrigir, em uma frase, para o aviso junto do botão de gravar. */
export function primeiroProblemaDaJanela(valor: TimeWindow[] | null): string | null {
  const problemas = problemasDaJanela(valor);
  if (problemas.geral) return problemas.geral;
  const i = problemas.faixas.findIndex((p) => p !== null);
  return i >= 0 ? `Faixa ${i + 1}: ${problemas.faixas[i]}` : null;
}
