import type {
  Category,
  ItemSelection,
  ItemTotal,
  Menu,
  MenuProduct,
  OptionGroup,
  Store,
  StoreHours,
  Uuid,
} from "../types";
import type { MenuSource } from "../menu-source";
import { PedidoRecusado } from "../sacola";

/**
 * Dados de exemplo da etapa A1. Satisfazem os tipos que saíram da migração base, e não
 * inventam campo nenhum: o que não existe no schema não existe aqui.
 *
 * O cálculo de total e o estado de horário estão aqui apenas como dublês das functions
 * do banco. A fonte de verdade dos dois é o banco (regras 5 e 6 do CLAUDE.md).
 */

const STORE_ID: Uuid = "11111111-1111-4111-8111-111111111111";
/**
 * Ids de exemplo que são UUID de verdade: só hexadecimal, doze dígitos no último grupo.
 * A primeira casa diz o tipo (1 categoria, 2 produto, 3 grupo, 4 opção), e o resto é o
 * número da chave. Ids fora do formato eram recusados pelo zod na entrada do pixel, que
 * é exatamente o que a validação existe para pegar.
 */
const TIPO: Record<string, string> = { c: "1", p: "2", g: "3", o: "4" };
const id = (chave: string): Uuid => {
  const tipo = TIPO[chave[0]] ?? "9";
  const numero = chave.slice(1).padStart(11, "0");
  return `11111111-1111-4111-8111-${tipo}${numero}`;
};

const store: Store = {
  id: STORE_ID,
  slug: "jardim-secreto",
  name: "Jardim Secreto",
  timezone: "America/Sao_Paulo",
  business_day_start: "04:00",
  opening_hours: [
    { dow: 3, open: "18:00", close: "23:30" },
    { dow: 4, open: "18:00", close: "23:30" },
    { dow: 5, open: "18:00", close: "02:00" },
    { dow: 6, open: "12:00", close: "02:00" },
    { dow: 0, open: "12:00", close: "22:00" },
  ],
  tab_mode: "mesa_unica",
  logo_url: null,
  primary_color: "#2f3927",
  accent_color: "#5a6b4a",
};

const categories: Category[] = [
  { id: id("c1"), store_id: STORE_ID, name: "Para começar", sort_order: 1, is_active: true },
  { id: id("c2"), store_id: STORE_ID, name: "Da horta", sort_order: 2, is_active: true },
  { id: id("c3"), store_id: STORE_ID, name: "Da brasa", sort_order: 3, is_active: true },
  { id: id("c4"), store_id: STORE_ID, name: "Sanduíches", sort_order: 4, is_active: true },
  { id: id("c5"), store_id: STORE_ID, name: "Chopp e cerveja", sort_order: 5, is_active: true },
  { id: id("c6"), store_id: STORE_ID, name: "Drinks do jardim", sort_order: 6, is_active: true },
  { id: id("c7"), store_id: STORE_ID, name: "Doces", sort_order: 7, is_active: true },
];

const pontoDaCarne: OptionGroup = {
  id: id("g1"),
  name: "Ponto da carne",
  min_select: 1,
  max_select: 1,
  sort_order: 1,
  options: [
    { id: id("o11"), group_id: id("g1"), name: "Ao ponto para menos", price_delta: 0, is_available: true, sort_order: 1 },
    { id: id("o12"), group_id: id("g1"), name: "Ao ponto", price_delta: 0, is_available: true, sort_order: 2 },
    { id: id("o13"), group_id: id("g1"), name: "Ao ponto para mais", price_delta: 0, is_available: true, sort_order: 3 },
    { id: id("o14"), group_id: id("g1"), name: "Bem passada", price_delta: 0, is_available: true, sort_order: 4 },
  ],
};

const adicionaisBurger: OptionGroup = {
  id: id("g2"),
  name: "Adicionais",
  min_select: 0,
  max_select: 3,
  sort_order: 2,
  options: [
    { id: id("o21"), group_id: id("g2"), name: "Queijo da serra", price_delta: 6, is_available: true, sort_order: 1 },
    { id: id("o22"), group_id: id("g2"), name: "Bacon artesanal", price_delta: 8, is_available: true, sort_order: 2 },
    { id: id("o23"), group_id: id("g2"), name: "Cebola caramelizada", price_delta: 5, is_available: true, sort_order: 3 },
    { id: id("o24"), group_id: id("g2"), name: "Ovo caipira", price_delta: 4, is_available: false, sort_order: 4 },
  ],
};

const tamanhoChopp: OptionGroup = {
  id: id("g3"),
  name: "Tamanho",
  min_select: 1,
  max_select: 1,
  sort_order: 1,
  options: [
    { id: id("o31"), group_id: id("g3"), name: "Taça 300ml", price_delta: 0, is_available: true, sort_order: 1 },
    { id: id("o32"), group_id: id("g3"), name: "Caneca 500ml", price_delta: 7, is_available: true, sort_order: 2 },
    { id: id("o33"), group_id: id("g3"), name: "Torre 1,5L", price_delta: 48, is_available: true, sort_order: 3 },
  ],
};

const acompanhamento: OptionGroup = {
  id: id("g4"),
  name: "Acompanhamento",
  min_select: 1,
  max_select: 2,
  sort_order: 3,
  options: [
    { id: id("o41"), group_id: id("g4"), name: "Batata rústica", price_delta: 0, is_available: true, sort_order: 1 },
    { id: id("o42"), group_id: id("g4"), name: "Arroz de alho", price_delta: 0, is_available: true, sort_order: 2 },
    { id: id("o43"), group_id: id("g4"), name: "Salada da horta", price_delta: 4, is_available: true, sort_order: 3 },
    { id: id("o44"), group_id: id("g4"), name: "Purê de mandioquinha", price_delta: 6, is_available: true, sort_order: 4 },
  ],
};

interface Seed {
  key: string;
  cat: string;
  name: string;
  price: number;
  emoji: string;
  description?: string;
  featured?: boolean;
  unavailable?: boolean;
  groups?: OptionGroup[];
  pdv: string;
}

const seeds: Seed[] = [
  { key: "p01", cat: "c1", name: "Pão de fermentação natural", price: 24, emoji: "🍞", description: "Pão do dia, manteiga de ervas da casa e flor de sal.", pdv: "PDV-1001" },
  { key: "p02", cat: "c1", name: "Bolinho de mandioca", price: 32, emoji: "🥟", description: "Oito unidades, com maionese de limão queimado.", featured: true, pdv: "PDV-1002" },
  { key: "p03", cat: "c1", name: "Azeitonas marinadas", price: 18, emoji: "🫒", description: "Azeitonas verdes, alecrim e raspas de laranja.", pdv: "PDV-1003" },
  { key: "p04", cat: "c1", name: "Queijo coalho na brasa", price: 29, emoji: "🧀", description: "Com mel de engenho e pimenta rosa.", unavailable: true, pdv: "PDV-1004" },
  { key: "p05", cat: "c2", name: "Salada da horta", price: 34, emoji: "🥗", description: "Folhas colhidas no dia, tomate assado e castanha.", pdv: "PDV-1101" },
  { key: "p06", cat: "c2", name: "Abóbora assada", price: 38, emoji: "🎃", description: "Abóbora, tahine, melado e semente tostada.", pdv: "PDV-1102" },
  { key: "p07", cat: "c2", name: "Berinjela do jardim", price: 36, emoji: "🍆", description: "Berinjela grelhada, iogurte de castanha e hortelã.", pdv: "PDV-1103" },
  { key: "p08", cat: "c3", name: "Ancho na brasa", price: 92, emoji: "🥩", description: "300g, na grelha de carvão, com acompanhamento.", featured: true, groups: [pontoDaCarne, acompanhamento], pdv: "PDV-1201" },
  { key: "p09", cat: "c3", name: "Fraldinha do jardim", price: 78, emoji: "🍖", description: "250g, manteiga de alho assado e acompanhamento.", groups: [pontoDaCarne, acompanhamento], pdv: "PDV-1202" },
  { key: "p10", cat: "c3", name: "Frango de quintal", price: 64, emoji: "🍗", description: "Meio frango, limão siciliano e acompanhamento.", groups: [acompanhamento], pdv: "PDV-1203" },
  { key: "p11", cat: "c3", name: "Costela de porco", price: 86, emoji: "🥓", description: "Seis horas de forno, glacê de goiabada e acompanhamento.", groups: [acompanhamento], pdv: "PDV-1204" },
  { key: "p12", cat: "c4", name: "Burger do jardim", price: 54, emoji: "🍔", description: "180g de blend da casa, queijo meia cura e pão brioche.", featured: true, groups: [pontoDaCarne, adicionaisBurger], pdv: "PDV-1301" },
  { key: "p13", cat: "c4", name: "Burger de cogumelo", price: 49, emoji: "🍄", description: "Hambúrguer de shimeji, maionese defumada e rúcula.", groups: [adicionaisBurger], pdv: "PDV-1302" },
  { key: "p14", cat: "c4", name: "Sanduíche de pernil", price: 46, emoji: "🥖", description: "Pernil desfiado, vinagrete de abacaxi e pão de fermentação natural.", pdv: "PDV-1303" },
  { key: "p15", cat: "c5", name: "Chopp Pilsen da casa", price: 16, emoji: "🍺", description: "Feito para a casa, leve e seco.", featured: true, groups: [tamanhoChopp], pdv: "PDV-1401" },
  { key: "p16", cat: "c5", name: "Chopp IPA", price: 19, emoji: "🍻", description: "Amargor médio, aroma de maracujá.", groups: [tamanhoChopp], pdv: "PDV-1402" },
  { key: "p17", cat: "c5", name: "Cerveja de trigo", price: 22, emoji: "🌾", description: "Garrafa 500ml, turva e refrescante.", pdv: "PDV-1403" },
  { key: "p18", cat: "c5", name: "Cerveja sem álcool", price: 18, emoji: "🚫", description: "Garrafa 355ml, lager sem álcool.", pdv: "PDV-1404" },
  { key: "p19", cat: "c6", name: "Gin da horta", price: 39, emoji: "🍸", description: "Gin, tônica artesanal, pepino e manjericão.", featured: true, pdv: "PDV-1501" },
  { key: "p20", cat: "c6", name: "Caipirinha de cachaça", price: 32, emoji: "🍋", description: "Cachaça de alambique e limão taiti.", pdv: "PDV-1502" },
  { key: "p21", cat: "c6", name: "Negroni de barril", price: 42, emoji: "🥃", description: "Maturado por trinta dias no barril.", pdv: "PDV-1503" },
  { key: "p22", cat: "c6", name: "Limonada de capim", price: 16, emoji: "🥤", description: "Sem álcool. Capim-limão do jardim e gengibre.", pdv: "PDV-1504" },
  { key: "p23", cat: "c7", name: "Pudim de baunilha", price: 26, emoji: "🍮", description: "Baunilha de verdade e calda escura.", pdv: "PDV-1601" },
  { key: "p24", cat: "c7", name: "Banana na brasa", price: 28, emoji: "🍌", description: "Com sorvete de doce de leite e farofa de castanha.", pdv: "PDV-1602" },
];

/**
 * Todo produto de exemplo tem foto: ilustrações geradas por IA, processadas pelas regras do
 * upload real (scripts/gerar-fotos-mock.mjs) e servidas de public/mock/produtos. O emoji
 * continua no dado porque é a reserva de produto sem foto (JM-002), e o admin o edita.
 */
const products: MenuProduct[] = seeds.map((s, i) => ({
  id: id(s.key),
  store_id: STORE_ID,
  category_id: id(s.cat),
  name: s.name,
  description: s.description ?? null,
  price: s.price,
  photo_path: `/mock/produtos/${s.key}`,
  emoji: s.emoji,
  is_featured: s.featured ?? false,
  is_available: !s.unavailable,
  unavailable_since: s.unavailable ? "2026-09-11T19:12:00-03:00" : null,
  available_window: null,
  pdv_code: s.pdv,
  sort_order: i + 1,
  option_groups: s.groups ?? [],
}));

const menu: Menu = { store, table_number: 7, categories, products };

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espelha `stores.opening_hours`, mas quem decide de verdade é o banco (D12). */
function hoursFromClock(now: Date): StoreHours {
  const dow = now.getDay();
  const janela = store.opening_hours?.find((w) => w.dow === dow);
  if (!store.opening_hours) return { is_open: true, opens_at_local: null, opens_day_offset: null, closes_at_local: null };
  if (!janela) {
    // Dublê: o banco calcula de verdade, no fuso da loja (store_hours_state).
    const proximos = store.opening_hours.map((w) => ({ w, dias: (w.dow - dow + 7) % 7 || 7 }));
    const proxima = proximos.sort((a, b) => a.dias - b.dias)[0];
    return { is_open: false, opens_at_local: proxima?.w.open ?? null, opens_day_offset: proxima?.dias ?? null, closes_at_local: null };
  }

  const minutos = now.getHours() * 60 + now.getMinutes();
  const [ho, mo] = janela.open.split(":").map(Number);
  const [hc, mc] = janela.close.split(":").map(Number);
  const abre = ho * 60 + mo;
  const fecha = hc * 60 + mc;
  const aberta = fecha > abre ? minutos >= abre && minutos < fecha : minutos >= abre || minutos < fecha;

  return {
    is_open: aberta,
    opens_at_local: aberta ? null : janela.open,
    opens_day_offset: aberta ? null : 0,
    closes_at_local: janela.close,
  };
}

/**
 * `?aberto=1` na URL força a loja de exemplo aberta, para demonstrar o envio fora do
 * horário do exemplo. Só existe aqui: a fonte real pergunta ao banco (D12).
 */
function horarioDeExemplo(): StoreHours {
  const forcado =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("aberto") === "1";
  if (forcado) return { is_open: true, opens_at_local: null, opens_day_offset: null, closes_at_local: null };
  return hoursFromClock(new Date());
}

/** Numeração de demonstração, por carregamento da tela. A real é por loja e turno (JM-036). */
let proximoNumeroDeDemonstracao = 1;

export const mockMenuSource: MenuSource = {
  envio: "demonstracao",

  async getMenu() {
    await delay(180);
    return menu;
  },

  async getHours() {
    await delay(60);
    return horarioDeExemplo();
  },

  /**
   * Dublê do envio, só para demonstração. Recusa como o banco vai recusar na Fase B:
   * sacola vazia, loja fechada (JM-005), produto esgotado (JM-004) e quantidade fora do
   * limite. Não grava, não chama rota e não conta no pixel.
   */
  async enviarPedido(itens: ItemSelection[]) {
    await delay(450);
    if (itens.length === 0) throw new PedidoRecusado("SACOLA_VAZIA", "A sacola está vazia.");
    if (!horarioDeExemplo().is_open) {
      throw new PedidoRecusado(
        "LOJA_FECHADA",
        "A casa está fechada agora. O pedido fica disponível no horário de funcionamento.",
      );
    }
    for (const item of itens) {
      const produto = products.find((p) => p.id === item.product_id);
      if (!produto) throw new PedidoRecusado("JM404", "Um item da sacola saiu do cardápio.");
      if (!produto.is_available) throw new PedidoRecusado("JM451", `Produto indisponível agora: ${produto.name}.`);
      if (item.quantity < 1 || item.quantity > 20) throw new PedidoRecusado("JM422", "Quantidade fora do limite.");
    }
    return { numero: proximoNumeroDeDemonstracao++ };
  },

  /**
   * Dublê da function do banco. A conta real é `tablet_item_total` (PLANO-SCHEMA §7.1):
   * o cliente manda product_id, quantity e option_ids, e o servidor devolve o total.
   */
  async getItemTotal(selection: ItemSelection): Promise<ItemTotal> {
    await delay(90);
    const produto = products.find((p) => p.id === selection.product_id);
    if (!produto) throw new Error("produto não encontrado");

    const delta = produto.option_groups
      .flatMap((g) => g.options)
      .filter((o) => selection.option_ids.includes(o.id))
      .reduce((soma, o) => soma + o.price_delta, 0);

    const unit = produto.price + delta;
    return { unit_total: unit, line_total: unit * selection.quantity };
  },
};
