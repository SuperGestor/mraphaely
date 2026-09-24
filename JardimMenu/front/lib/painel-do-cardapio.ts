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
 * 3. **A régua também é do banco.** Quem separa "pouco visto" de "merece destaque" é a
 *    function, com a porcentagem gravada na loja (decisão do PO em 24/09/2026). Daqui sai
 *    só a frase que explica a régua que já foi aplicada, nunca uma segunda conta que
 *    pudesse discordar da lista mostrada ao lado.
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
  /** Fração da mediana escolhida pela casa: 0.25 é 25%. Vem de `stores.menu_panel_low_view_pct`. */
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
  /**
   * Vende e quase não aparece (decisão do PO em 24/09/2026). É a única lista que pede para
   * CRESCER, e por isso ela vem antes das outras na tela; quem está aqui foi tirado de
   * `never_seen` e de `low_seen` pela própria function, que são listas de "considere tirar
   * do cardápio". Já chega ordenada: mais vendidos primeiro.
   */
  deserve_highlight: LinhaDoPainel[];
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
  deserve_highlight: z.array(linhaSchema),
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

/** O painel tem alguma linha em alguma das cinco listas? */
export function painelVazio(painel: PainelDoCardapio): boolean {
  return (
    painel.deserve_highlight.length === 0 &&
    painel.never_seen.length === 0 &&
    painel.low_seen.length === 0 &&
    painel.seen_no_conversion.length === 0 &&
    painel.champions.length === 0
  );
}

// --------------------------------------------------------------- merece destaque

/**
 * Uma aparição, várias aparições: o plural muda, e a frase da tela é lida em voz alta.
 *
 * A mediana pode vir quebrada (o `percentile_cont` do banco devolve o meio entre dois
 * valores quando o número de produtos é par), então o número passa pelo formato do Brasil:
 * "78,5", e não "78.5".
 */
const contagem = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function vezes(n: number): string {
  return n === 1 ? "1 vez" : `${contagem.format(n)} vezes`;
}

function aparicoes(n: number): string {
  return n === 1 ? "1 aparição" : `${contagem.format(n)} aparições`;
}

export interface LeituraDoDestaque {
  /** Por que este produto está na lista, em palavras: é isso que a linha mostra. */
  frase: string;
  /**
   * Nenhuma aparição foi registrada. Sem denominador não há conversão, e a tela não pode
   * dizer que o produto "não apareceu": na Fase B todo pedido passa pelo tablet, então isso
   * quase sempre é o registro que se perdeu por falta de rede, e não a tela vazia.
   */
  semRegistro: boolean;
}

/**
 * A leitura que o dono da casa precisa ter da lista "merece destaque": "pedido X vezes em
 * apenas Y aparições". É frase, e não número solto, porque ela é lida no celular entre uma
 * mesa e outra, e o que importa é a comparação, não o par de contadores.
 *
 * Não recalcula nada: quem decidiu que este produto merece destaque foi a function, com a
 * régua da loja. Aqui só se escreve o que já está decidido.
 */
export function lerDestaque(linha: LinhaDoPainel): LeituraDoDestaque {
  const pedido = `Pedido ${vezes(linha.orders)}`;
  if (linha.impressions === 0) {
    return { frase: `${pedido}, e nenhuma aparição na tela chegou a ser registrada.`, semRegistro: true };
  }
  return { frase: `${pedido} em apenas ${aparicoes(linha.impressions)} na tela.`, semRegistro: false };
}

// --------------------------------------------------------------- a régua da casa

/** Mínimo aceito pela function e pelo CHECK de `stores`. Zero desligaria a lista sem dizer. */
export const MINIMO_DA_REGUA = 1;
/** Máximo aceito: acima da mediana, "pouco visto" deixaria de querer dizer alguma coisa. */
export const MAXIMO_DA_REGUA = 100;

/** 0.25 vira 25. A fração é do banco; aqui ela só troca de roupa para caber no campo. */
export function porcentagemDaRegua(regua: ReguaDoPainel): number {
  return Math.round(regua.low_view_fraction * 100);
}

/**
 * Quantas aparições ainda cabem na régua, em número inteiro. A function compara
 * `impressões <= mediana × fração`, e `low_view_max` já é esse produto, calculado em
 * `numeric` no banco: arredondar para baixo é só dizer em número contável o que a
 * comparação faz, sem refazer a conta aqui.
 *
 * Sem mediana (ninguém visto no turno) o piso é zero: só entra quem não tem registro.
 */
export function pisoDeAparicoes(regua: ReguaDoPainel): number {
  return regua.low_view_max === null ? 0 : Math.floor(regua.low_view_max);
}

/**
 * O efeito da régua em palavras, com a mediana do turno à vista. Número solto ("25%") não
 * diz nada a quem está no salão; "entra quem apareceu no máximo 18 vezes" diz.
 */
export function rotuloDaRegua(regua: ReguaDoPainel): string {
  const pct = porcentagemDaRegua(regua);
  if (regua.median_impressions === null) {
    return `A régua está em ${pct}% da mediana do turno, mas neste turno nenhum produto apareceu na tela ainda: sem mediana, só entra na lista quem foi pedido sem nenhuma aparição registrada.`;
  }
  const piso = pisoDeAparicoes(regua);
  const mediana = `A mediana do turno é ${aparicoes(regua.median_impressions)}`;
  if (piso === 0) {
    return `${mediana}, e ${pct}% dela não chega a uma aparição: hoje a régua só pega quem foi pedido sem nenhuma aparição registrada.`;
  }
  return `${mediana}, e ${pct}% dela dá ${vezes(piso)}: hoje entra na régua o produto que apareceu no máximo ${vezes(piso)}.`;
}

export type LeituraDaRegua = { ok: true; pct: number } | { ok: false; problema: string };

/**
 * Lê a porcentagem que a pessoa digitou. A function recusa fora de 1 a 100 com JM422, e o
 * CHECK da tabela recusa depois dela; esta leitura não substitui nenhuma das duas, ela só
 * evita a ida ao servidor e diz o limite em português.
 */
export function lerRegua(texto: string): LeituraDaRegua {
  const limpo = texto.trim();
  if (!limpo) return { ok: false, problema: "Informe a porcentagem da régua." };
  if (!/^\d+$/.test(limpo)) return { ok: false, problema: "Use só número inteiro, sem vírgula e sem o sinal de porcento." };

  const pct = Number(limpo);
  if (pct < MINIMO_DA_REGUA || pct > MAXIMO_DA_REGUA) {
    return {
      ok: false,
      problema: `A régua vai de ${MINIMO_DA_REGUA}% a ${MAXIMO_DA_REGUA}% da mediana do turno.`,
    };
  }
  return { ok: true, pct };
}
