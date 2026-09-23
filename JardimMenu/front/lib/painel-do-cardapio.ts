import { z } from "zod";

/**
 * Leitura do painel do cardápio (JM-062, P9): o jsonb que a function `admin_menu_panel`
 * devolve, conferido antes de virar tela.
 *
 * Mesmo desenho de `janela-do-produto.ts`: zod na entrada do que vem do banco, regra pura
 * fora do componente, para o Vitest provar sem JSX. A validação de verdade (papel, loja,
 * turno no futuro) é da function; o zod daqui existe porque um jsonb com chave faltando
 * quebraria a tela no meio da renderização em vez de mostrar erro com ação de repetir.
 *
 * Duas coisas que a tela precisa dizer em voz alta, e por isso estão documentadas aqui:
 *
 * 1. **A conversão vem do pedido, não do pixel.** Impressão, clique e "na sacola" são
 *    contados em `menu_events`; pedido e quantidade saem de `orders`/`order_items`, sem
 *    item removido e sem pedido cancelado (JM-033). O evento `order_submitted` do pixel é
 *    gravado sem produto, então ele não serve para esta conta.
 * 2. **O turno é do banco.** `business_date` já vem resolvido por `shift_date` (D12, regra
 *    5 do CLAUDE.md). Nada aqui calcula "hoje", e a formatação da data é troca de posição
 *    de texto, sem `Date` e sem fuso.
 */

/** Uma linha do painel: um produto, com os números do turno. */
export interface LinhaDoPainel {
  product_id: string;
  name: string;
  category: string;
  /** Falso quando o produto saiu do cardápio mas teve movimento no turno. */
  in_menu: boolean;
  impressions: number;
  clicks: number;
  adds_to_cart: number;
  /** Pedidos não cancelados com o item não removido. Vem do pedido, não do pixel. */
  orders: number;
  quantity: number;
  /** Pedidos ÷ impressões. Nulo sem impressão: sem denominador não há taxa. */
  conversion: number | null;
}

/** A régua que a function usou, para a tela explicar a lista em vez de mostrar número solto. */
export interface ReguaDoPainel {
  low_view_fraction: number;
  /** Mediana de impressões dos produtos vistos no turno. Nula quando ninguém foi visto. */
  median_impressions: number | null;
  low_view_max: number | null;
  champion_min_impressions: number | null;
  champions_limit: number;
}

export interface TotaisDoPainel {
  impressions: number;
  clicks: number;
  adds_to_cart: number;
  ordered_products: number;
  orders: number;
  products: number;
}

export interface PainelDoCardapio {
  /** Turno mostrado, "AAAA-MM-DD", resolvido por `shift_date` no banco. */
  business_date: string;
  current_business_date: string;
  previous_business_date: string;
  /** Nulo quando o turno mostrado já é o de hoje: o painel não anda para o futuro. */
  next_business_date: string | null;
  rules: ReguaDoPainel;
  totals: TotaisDoPainel;
  never_seen: LinhaDoPainel[];
  low_seen: LinhaDoPainel[];
  seen_no_conversion: LinhaDoPainel[];
  champions: LinhaDoPainel[];
}

/**
 * `numeric` do Postgres pode chegar como número ou como texto, conforme o driver (a mesma
 * ressalva de `admin-source.ts`): a coerção deixa os dois passarem sem mascarar ausência,
 * porque `null` continua sendo `null`.
 */
const numero = z.coerce.number();
const dataDoTurno = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const linhaSchema = z.object({
  product_id: z.string(),
  name: z.string(),
  category: z.string(),
  in_menu: z.boolean(),
  impressions: numero,
  clicks: numero,
  adds_to_cart: numero,
  orders: numero,
  quantity: numero,
  conversion: numero.nullable(),
});

const painelSchema = z.object({
  business_date: dataDoTurno,
  current_business_date: dataDoTurno,
  previous_business_date: dataDoTurno,
  next_business_date: dataDoTurno.nullable(),
  rules: z.object({
    low_view_fraction: numero,
    median_impressions: numero.nullable(),
    low_view_max: numero.nullable(),
    champion_min_impressions: numero.nullable(),
    champions_limit: numero,
  }),
  totals: z.object({
    impressions: numero,
    clicks: numero,
    adds_to_cart: numero,
    ordered_products: numero,
    orders: numero,
    products: numero,
  }),
  never_seen: z.array(linhaSchema),
  low_seen: z.array(linhaSchema),
  seen_no_conversion: z.array(linhaSchema),
  champions: z.array(linhaSchema),
});

/** Lança quando o formato não bate: a tela trata como erro e oferece repetir. */
export function lerPainel(bruto: unknown): PainelDoCardapio {
  return painelSchema.parse(bruto);
}

/**
 * "23/09/2026" a partir de "2026-09-23". Troca de posição de texto, e não aritmética de
 * calendário: quem decide o turno é o banco (regra 5), e um `new Date("2026-09-23")` aqui
 * viraria UTC e poderia mostrar o dia anterior.
 */
export function rotuloDoTurno(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso;
}

/** "12%" a partir de 0.1234. Nulo vira travessão: sem impressão não existe taxa. */
export function rotuloDeConversao(conversao: number | null): string {
  return conversao === null ? "—" : `${Math.round(conversao * 100)}%`;
}

/** O painel tem alguma linha em alguma das quatro listas? */
export function painelVazio(painel: PainelDoCardapio): boolean {
  return (
    painel.never_seen.length === 0 &&
    painel.low_seen.length === 0 &&
    painel.seen_no_conversion.length === 0 &&
    painel.champions.length === 0
  );
}
