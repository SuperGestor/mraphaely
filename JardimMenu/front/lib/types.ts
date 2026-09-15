/**
 * Tipos do domínio, derivados do schema gerado. `npm run db:types` escreve
 * lib/database.types.ts a partir do Supabase local, e o schema é a fonte de verdade:
 * coluna renomeada ou removida quebra o `tsc` aqui, e não em produção.
 *
 * O gerador não sabe dizer quatro coisas, e só elas são afinadas à mão:
 * - jsonb (`opening_hours`, `available_window`) ganha o formato fechado `TimeWindow[]`;
 * - text com check (`role`, `status`, `tab_mode`) ganha a união dos valores aceitos;
 * - coluna gerada (`is_paired`) sai anulável no gerador, mas nunca é nula;
 * - retorno de function sai sem nulos no gerador, então `StoreHours` e `Menu` continuam
 *   escritos aqui, com os nomes conferidos contra o banco.
 *
 * Regra 6 do CLAUDE.md: preço é do servidor. Por isso `ItemTotal` é resultado de
 * chamada, e não de conta no front.
 */
import type { Database } from "./database.types";

type Linha<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
type RetornoDe<F extends keyof Database["public"]["Functions"]> = Database["public"]["Functions"][F]["Returns"];
type MesmasChaves<A, B> = [Exclude<keyof A, keyof B> | Exclude<keyof B, keyof A>] extends [never] ? true : false;
type Confere<T extends true> = T;

export type Uuid = string;

/** Formato fechado de `stores.opening_hours` e de `products.available_window`. */
export interface TimeWindow {
  /** 0 = domingo. Dia ausente significa fechado. */
  dow: number;
  /** "18:00" */
  open: string;
  /** "02:00". Fim menor que início cruza a meia-noite. */
  close: string;
}

export type TabMode = "mesa_unica" | "nomeada";

export type Store = Pick<
  Linha<"stores">,
  "id" | "slug" | "name" | "timezone" | "business_day_start" | "logo_url" | "primary_color" | "accent_color"
> & {
  opening_hours: TimeWindow[] | null;
  tab_mode: TabMode;
};

export type Category = Pick<Linha<"categories">, "id" | "store_id" | "name" | "sort_order" | "is_active">;

/** `price_delta` é numeric(10,2) no banco e chega como número. */
export type ProductOption = Pick<
  Linha<"options">,
  "id" | "group_id" | "name" | "price_delta" | "is_available" | "sort_order"
>;

export type OptionGroup = Pick<Linha<"option_groups">, "id" | "name" | "min_select" | "max_select"> & {
  /** Ordem do grupo dentro do produto, de `product_option_groups`. */
  sort_order: Linha<"product_option_groups">["sort_order"];
  options: ProductOption[];
};

/** `pdv_code` é o código no PDV da casa (D31, JM-190), e nunca é exibido ao cliente. */
export type Product = Pick<
  Linha<"products">,
  | "id"
  | "store_id"
  | "category_id"
  | "name"
  | "description"
  | "price"
  | "photo_path"
  | "emoji"
  | "is_featured"
  | "is_available"
  | "unavailable_since"
  | "pdv_code"
  | "sort_order"
> & {
  available_window: TimeWindow[] | null;
};

/** Produto com os grupos de complementos que o cardápio precisa para o modal. */
export interface MenuProduct extends Product {
  option_groups: OptionGroup[];
}

/** Formato do jsonb de `tablet_menu`. */
export interface Menu {
  store: Store;
  /** Mesa do dispositivo que pediu o cardápio. Nula para aparelho sem mesa. */
  table_number: number | null;
  categories: Category[];
  products: MenuProduct[];
}

/**
 * Estado de horário resolvido **no banco** (regra 5 do CLAUDE.md, D12): nenhuma
 * aritmética de fuso no JavaScript.
 */
export interface StoreHours {
  is_open: boolean;
  /** "19:00", em hora local da loja. Nulo quando a loja está aberta. */
  opens_at_local: string | null;
  /**
   * Em quantos dias abre (0 hoje, 1 amanhã), calculado no banco. A tela só rotula o
   * número, sem aritmética de calendário (regra 5).
   */
  opens_day_offset: number | null;
  /** Nulo quando a loja não tem restrição de horário. */
  closes_at_local: string | null;
}
export type StoreHoursBateComOBanco = Confere<MesmasChaves<StoreHours, RetornoDe<"store_hours_state">[number]>>;

/** Escolha do cliente dentro do modal do produto. */
export interface ItemSelection {
  product_id: Uuid;
  quantity: number;
  option_ids: Uuid[];
  notes: string | null;
}

/**
 * Total do item, calculado no servidor (JM-031): `unit_total` é uma unidade com os
 * complementos, e `line_total` é ela vezes a quantidade. O front só exibe.
 */
export type ItemTotal = RetornoDe<"tablet_item_total">[number];

/** Erro de regra devolvido pelo servidor, com código estável (JM-004, JM-100). */
export interface RuleError {
  code: string;
  message: string;
}

/* ---------------------------------------------------------------------------
 * Modelos de leitura do painel de configuração. `tables.qr_token`,
 * `devices.token_hash` e `devices.pairing_code_hash` ficam fora do Pick, e nunca
 * aparecem em resposta de API (NF-006).
 * ------------------------------------------------------------------------- */

export type TableRow = Pick<
  Linha<"tables">,
  "id" | "store_id" | "number" | "label" | "ordering_enabled" | "ordering_disabled_reason" | "is_active"
>;

export type DeviceStatus = "active" | "inactive" | "retired";

export type DeviceRow = Pick<
  Linha<"devices">,
  "id" | "store_id" | "table_id" | "name" | "app_version" | "battery_level" | "last_seen_at" | "pairing_expires_at"
> & {
  /** Número da mesa, resolvido na leitura, para a tela não precisar juntar. */
  table_number: Linha<"tables">["number"] | null;
  status: DeviceStatus;
  /** Derivado no banco: o tablet já trocou o código pelo token (JM-180). */
  is_paired: boolean;
};

export type StoreRole = "owner" | "manager" | "waiter" | "kitchen";

export type StoreUserRow = Pick<Linha<"store_users">, "id" | "store_id" | "user_id" | "is_active"> & {
  /** Vem de `auth.users`, e não de `store_users`. */
  email: string;
  role: StoreRole;
};
