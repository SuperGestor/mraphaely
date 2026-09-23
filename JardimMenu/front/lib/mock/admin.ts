import type { DeviceRow, StoreUserRow, TableRow } from "../types";

/** Dados de exemplo do painel de configuração, na etapa A1. */

const STORE_ID = "11111111-1111-4111-8111-111111111111";
/** Ids de exemplo em UUID válido: doze dígitos hexadecimais no último grupo. */
const id = (p: string, n: number) => `11111111-1111-4111-8111-${p}${String(n).padStart(8, "0")}`;

const agora = Date.now();
const minutosAtras = (m: number) => new Date(agora - m * 60_000).toISOString();

export const mockTables: TableRow[] = Array.from({ length: 10 }, (_, i) => {
  const numero = i + 1;
  const desligada = numero === 4 || numero === 9;
  return {
    id: id("3333", numero),
    store_id: STORE_ID,
    number: numero,
    label: numero <= 6 ? `Jardim ${numero}` : `Varanda ${numero - 6}`,
    ordering_enabled: !desligada,
    ordering_disabled_reason: desligada
      ? numero === 4
        ? "Tablet com a tela trincada"
        : "Mesa reservada para evento"
      : null,
    is_active: true,
  };
});

export const mockDevices: DeviceRow[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    id: id("4444", i + 1),
    store_id: STORE_ID,
    table_id: id("3333", i + 1),
    table_number: i + 1,
    name: `Tablet Mesa ${i + 1}`,
    status: "active" as const,
    app_version: "1.0.0",
    battery_level: [82, 64, 91, 14, 77, 55, 38, 96][i],
    last_seen_at: minutosAtras([1, 2, 1, 3, 1, 12, 2, 1][i]),
  })),
  {
    id: id("4444", 9),
    store_id: STORE_ID,
    table_id: id("3333", 9),
    table_number: 9,
    name: "Tablet Mesa 9",
    status: "inactive",
    app_version: "1.0.0",
    battery_level: null,
    last_seen_at: minutosAtras(240),
  },
  {
    id: id("4444", 10),
    store_id: STORE_ID,
    table_id: null,
    table_number: null,
    name: "Tablet reserva",
    status: "retired",
    app_version: "0.9.4",
    battery_level: null,
    last_seen_at: null,
  },
];

export const mockUsers: StoreUserRow[] = [
  { id: id("5555", 1), user_id: id("6666", 1), store_id: STORE_ID, email: "dono@jardimsecreto.com.br", role: "owner", is_active: true },
  { id: id("5555", 2), user_id: id("6666", 2), store_id: STORE_ID, email: "gestor@jardimsecreto.com.br", role: "manager", is_active: true },
  { id: id("5555", 3), user_id: id("6666", 3), store_id: STORE_ID, email: "salao@jardimsecreto.com.br", role: "waiter", is_active: true },
  { id: id("5555", 4), user_id: id("6666", 4), store_id: STORE_ID, email: "cozinha@jardimsecreto.com.br", role: "kitchen", is_active: false },
];

/** Tempo de mesa parada de exemplo (JM-122). É o padrão de `stores`: 3 h. */
export const MINUTOS_DE_MESA_PARADA_DE_EXEMPLO = 180;

/**
 * Painel do cardápio de exemplo (JM-062), no mesmo formato do jsonb de `admin_menu_panel`,
 * para `lib/painel-do-cardapio.ts` ler dos dois lados com o mesmo zod.
 *
 * O turno é uma data FIXA, escrita à mão. Sem banco não há `shift_date`, e calcular "hoje"
 * em JavaScript é exatamente o que a regra 5 do CLAUDE.md proíbe; uma data fixa deixa claro
 * que este número é de exemplo e mantém o modo de exemplo determinístico.
 *
 * Os números são coerentes com a régua da function: a mediana de impressões dos produtos
 * vistos é 40, então "pouco visto" é até 10 (um quarto) e "campeão" exige ao menos 40.
 */
const TURNO_DE_EXEMPLO = "2026-09-22";

interface LinhaDeExemplo {
  produto: string;
  nome: string;
  categoria: string;
  no_cardapio?: false;
  impressoes: number;
  cliques: number;
  sacola: number;
  pedidos: number;
  quantidade: number;
}

const linha = (l: LinhaDeExemplo) => ({
  product_id: id("7777", Number(l.produto)),
  name: l.nome,
  category: l.categoria,
  in_menu: l.no_cardapio ?? true,
  impressions: l.impressoes,
  clicks: l.cliques,
  adds_to_cart: l.sacola,
  orders: l.pedidos,
  quantity: l.quantidade,
  // Mesma conta da function: pedidos ÷ impressões, com quatro casas. Sem impressão não há
  // taxa, e a tela mostra travessão.
  conversion: l.impressoes > 0 ? Number((l.pedidos / l.impressoes).toFixed(4)) : null,
});

const nuncaVistos = [
  { produto: "4", nome: "Queijo coalho na brasa", categoria: "Para começar", impressoes: 0, cliques: 0, sacola: 0, pedidos: 0, quantidade: 0 },
  { produto: "18", nome: "Cerveja sem álcool", categoria: "Chopp e cerveja", impressoes: 0, cliques: 0, sacola: 0, pedidos: 0, quantidade: 0 },
  // Produto fora do cardápio que ainda teve pedido no turno: o pixel pode ter perdido a
  // impressão (sem rede, aparelho desligado), e por isso ele aparece aqui com o pedido.
  { produto: "21", nome: "Negroni de barril", categoria: "Drinks do jardim", no_cardapio: false as const, impressoes: 0, cliques: 0, sacola: 0, pedidos: 2, quantidade: 2 },
].map(linha);

const poucoVistos = [
  { produto: "3", nome: "Azeitonas marinadas", categoria: "Para começar", impressoes: 4, cliques: 1, sacola: 0, pedidos: 0, quantidade: 0 },
  { produto: "7", nome: "Berinjela do jardim", categoria: "Da horta", impressoes: 9, cliques: 2, sacola: 1, pedidos: 1, quantidade: 1 },
].map(linha);

const vistosSemConversao = [
  { produto: "11", nome: "Costela de porco", categoria: "Da brasa", impressoes: 74, cliques: 21, sacola: 4, pedidos: 0, quantidade: 0 },
  { produto: "6", nome: "Abóbora assada", categoria: "Da horta", impressoes: 51, cliques: 9, sacola: 1, pedidos: 0, quantidade: 0 },
].map(linha);

const campeoes = [
  { produto: "15", nome: "Chopp Pilsen da casa", categoria: "Chopp e cerveja", impressoes: 118, cliques: 77, sacola: 61, pedidos: 54, quantidade: 131 },
  { produto: "12", nome: "Burger do jardim", categoria: "Sanduíches", impressoes: 103, cliques: 58, sacola: 39, pedidos: 31, quantidade: 36 },
  { produto: "8", nome: "Ancho na brasa", categoria: "Da brasa", impressoes: 96, cliques: 44, sacola: 22, pedidos: 19, quantidade: 21 },
  { produto: "19", nome: "Gin da horta", categoria: "Drinks do jardim", impressoes: 82, cliques: 30, sacola: 15, pedidos: 12, quantidade: 14 },
].map(linha);

const todas = [...nuncaVistos, ...poucoVistos, ...vistosSemConversao, ...campeoes];
const somar = (campo: "impressions" | "clicks" | "adds_to_cart") => todas.reduce((t, l) => t + l[campo], 0);

export function mockPainelDoCardapio() {
  return {
    business_date: TURNO_DE_EXEMPLO,
    current_business_date: TURNO_DE_EXEMPLO,
    previous_business_date: "2026-09-21",
    // Nulo porque o turno mostrado já é o "de hoje" do exemplo: o painel não anda para o
    // futuro, e no exemplo não há turno anterior com dado para visitar.
    next_business_date: null,
    rules: {
      low_view_fraction: 0.25,
      median_impressions: 40,
      low_view_max: 10,
      champion_min_impressions: 40,
      champions_limit: 10,
    },
    totals: {
      impressions: somar("impressions"),
      clicks: somar("clicks"),
      adds_to_cart: somar("adds_to_cart"),
      ordered_products: todas.filter((l) => l.orders > 0).length,
      orders: 97,
      products: todas.length,
    },
    never_seen: nuncaVistos,
    low_seen: poucoVistos,
    seen_no_conversion: vistosSemConversao,
    champions: campeoes,
  };
}
