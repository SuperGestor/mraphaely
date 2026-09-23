import type { DeviceRow, StoreRole, StoreUserRow, TableRow, TabMode, TimeWindow, Uuid } from "./types";
import { MINUTOS_DE_MESA_PARADA_DE_EXEMPLO, mockDevices, mockPainelDoCardapio, mockTables, mockUsers } from "./mock/admin";
import { mockMenuSource } from "./mock/menu";

/**
 * Camada única de dados do painel de configuração, com o mesmo desenho do cardápio:
 * uma implementação de exemplo e uma real, e nenhuma tela sabe qual está ligada.
 *
 * - Exemplo: lê os dados de exemplo e RECUSA gravar, dizendo por quê. Fingir que gravou
 *   seria o pior tipo de mock.
 * - Real: fala com /api/admin/*, que lê sob RLS e escreve por function do banco.
 */

export interface LojaDoUsuario {
  store_id: Uuid;
  role: StoreRole;
  nome: string;
  slug: string;
}

export interface ContextoDoAdmin {
  email: string | null;
  lojas: LojaDoUsuario[];
}

export interface LojaConfig {
  id: Uuid;
  slug: string;
  name: string;
  timezone: string;
  business_day_start: string;
  opening_hours: TimeWindow[] | null;
  tab_mode: TabMode;
  /** Mesa parada: minutos sem pedido até a tela da equipe destacar a mesa (JM-122, P5). */
  idle_table_alert_minutes: number;
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
}

export interface CategoriaAdmin {
  id: Uuid;
  store_id: Uuid;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface ProdutoAdmin {
  id: Uuid;
  store_id: Uuid;
  category_id: Uuid;
  name: string;
  description: string | null;
  price: number;
  photo_path: string | null;
  emoji: string | null;
  is_featured: boolean;
  is_available: boolean;
  unavailable_since: string | null;
  available_window: TimeWindow[] | null;
  pdv_code: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface OpcaoAdmin {
  id: Uuid;
  group_id: Uuid;
  name: string;
  price_delta: number;
  pdv_code: string | null;
  is_available: boolean;
  sort_order: number;
}

export interface GrupoAdmin {
  id: Uuid;
  store_id: Uuid;
  name: string;
  min_select: number;
  max_select: number;
  options: OpcaoAdmin[];
}

export interface LigacaoAdmin {
  product_id: Uuid;
  group_id: Uuid;
  sort_order: number;
}

export interface CardapioAdmin {
  categorias: CategoriaAdmin[];
  produtos: ProdutoAdmin[];
  grupos: GrupoAdmin[];
  ligacoes: LigacaoAdmin[];
}

export class FalhaDoAdmin extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "FalhaDoAdmin";
  }
}

/**
 * Código que o convite devolve quando o e-mail já tem conta no Auth (JM-052). O mesmo
 * literal está em `back/controllers/usuarios.ts` (CONTA_JA_EXISTE): o back não é importado
 * por tela de navegador, então a constante existe dos dois lados, e uma aponta para a
 * outra. É código próprio, e não o JM409 genérico, porque a tela decide por ele se oferece
 * o botão de vincular a conta à loja.
 */
export const CODIGO_CONTA_JA_EXISTE = "JMU01";

export function ehContaJaExiste(erro: unknown): boolean {
  return erro instanceof FalhaDoAdmin && erro.codigo === CODIGO_CONTA_JA_EXISTE;
}

export interface AdminSource {
  modo: "exemplo" | "real";
  contexto(): Promise<ContextoDoAdmin>;
  loja(lojaId: Uuid): Promise<LojaConfig>;
  cardapio(lojaId: Uuid): Promise<CardapioAdmin>;
  mesas(lojaId: Uuid): Promise<TableRow[]>;
  dispositivos(lojaId: Uuid): Promise<DeviceRow[]>;
  usuarios(lojaId: Uuid): Promise<StoreUserRow[]>;
  /** Escrita por function do banco, pela lista fechada de /api/admin/rpc. */
  rpc(fn: string, params: Record<string, unknown>): Promise<unknown>;
  /** Parear é no próprio tablet, com o login do dono ou do gestor (21/09/2026). */
  alterarDispositivo(id: Uuid, corpo: { acao: "estado"; status: "active" | "inactive" | "retired" }): Promise<void>;
  convidar(dados: { store_id: Uuid; email: string; role: StoreRole }): Promise<void>;
  alterarUsuario(id: Uuid, corpo: { acao: "papel"; role: StoreRole } | { acao: "desativar" }): Promise<void>;
  enviarFoto(productId: Uuid, arquivo: File): Promise<string>;
}

// ------------------------------------------------------------------ exemplo

const SO_LEITURA = () =>
  Promise.reject(new FalhaDoAdmin(503, "JM503", "Modo de exemplo: sem banco configurado, nada é gravado."));

const exemplo: AdminSource = {
  modo: "exemplo",

  async contexto() {
    const menu = await mockMenuSource.getMenu("jardim-secreto");
    return {
      email: "exemplo@jardimsecreto.com.br",
      lojas: [{ store_id: menu.store.id, role: "owner", nome: menu.store.name, slug: menu.store.slug }],
    };
  },

  async loja() {
    const { store } = await mockMenuSource.getMenu("jardim-secreto");
    // O cardápio de exemplo não carrega o tempo de mesa parada (ele é do salão, JM-122):
    // o valor de exemplo entra aqui para a tela de mesas ter o que mostrar.
    return { ...store, idle_table_alert_minutes: MINUTOS_DE_MESA_PARADA_DE_EXEMPLO };
  },

  async cardapio() {
    const menu = await mockMenuSource.getMenu("jardim-secreto");
    const grupos = new Map<string, GrupoAdmin>();
    const ligacoes: LigacaoAdmin[] = [];
    for (const p of menu.products) {
      for (const g of p.option_groups) {
        ligacoes.push({ product_id: p.id, group_id: g.id, sort_order: g.sort_order });
        if (!grupos.has(g.id)) {
          grupos.set(g.id, {
            id: g.id,
            store_id: menu.store.id,
            name: g.name,
            min_select: g.min_select,
            max_select: g.max_select,
            options: g.options.map((o) => ({ ...o, pdv_code: null })),
          });
        }
      }
    }
    return {
      categorias: menu.categories,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- descarta os grupos, que no admin vêm à parte
      produtos: menu.products.map(({ option_groups: _grupos, ...p }) => ({ ...p, is_active: true })),
      grupos: [...grupos.values()],
      ligacoes,
    };
  },

  mesas: async () => mockTables,
  dispositivos: async () => mockDevices,
  usuarios: async () => mockUsers,

  /**
   * A lista de functions é de ESCRITA, com uma exceção de leitura: `admin_menu_panel`
   * (JM-062). No modo de exemplo a leitura responde com dados de exemplo, como as outras
   * leituras desta fonte, e toda escrita continua recusada, dizendo por quê.
   */
  async rpc(fn) {
    if (fn === "admin_menu_panel") return mockPainelDoCardapio();
    return SO_LEITURA();
  },

  alterarDispositivo: SO_LEITURA,
  convidar: SO_LEITURA,
  alterarUsuario: SO_LEITURA,
  enviarFoto: SO_LEITURA,
};

// ------------------------------------------------------------------ real

async function pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(caminho, { cache: "no-store", ...init });
  const corpo: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const erro = corpo as { codigo?: string; mensagem?: string } | null;
    throw new FalhaDoAdmin(resposta.status, erro?.codigo ?? "JM500", erro?.mensagem ?? "Falha ao falar com o servidor.");
  }
  return corpo as T;
}

const json = (corpo: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(corpo),
});

const dados = <T>(recurso: string, lojaId?: Uuid) =>
  pedir<T>(`/api/admin/dados/${recurso}${lojaId ? `?loja=${encodeURIComponent(lojaId)}` : ""}`);

const real: AdminSource = {
  modo: "real",

  async contexto() {
    const c = await dados<{
      email: string | null;
      lojas: { store_id: Uuid; role: StoreRole; stores: { name: string; slug: string } | null }[];
    }>("contexto");
    return {
      email: c.email,
      lojas: c.lojas.map((l) => ({
        store_id: l.store_id,
        role: l.role,
        nome: l.stores?.name ?? "Loja",
        slug: l.stores?.slug ?? "",
      })),
    };
  },

  loja: (lojaId) => dados<LojaConfig>("loja", lojaId),

  async cardapio(lojaId) {
    const c = await dados<CardapioAdmin>("cardapio", lojaId);
    // numeric do Postgres chega como número ou texto, conforme o driver: normaliza aqui.
    return {
      ...c,
      produtos: c.produtos.map((p) => ({ ...p, price: Number(p.price) })),
      grupos: c.grupos.map((g) => ({
        ...g,
        options: [...g.options]
          .map((o) => ({ ...o, price_delta: Number(o.price_delta) }))
          .sort((a, b) => a.sort_order - b.sort_order),
      })),
    };
  },

  async mesas(lojaId) {
    const r = await dados<{ mesas: (Omit<TableRow, "ordering_disabled_reason"> & { ordering_disabled_reason?: string | null })[] }>("mesas", lojaId);
    return r.mesas.map((m) => ({ ...m, ordering_disabled_reason: m.ordering_disabled_reason ?? null }));
  },

  async dispositivos(lojaId) {
    const r = await dados<{
      dispositivos: Omit<DeviceRow, "table_number">[];
      mesas: { id: Uuid; number: number }[];
    }>("dispositivos", lojaId);
    const numero = new Map(r.mesas.map((m) => [m.id, m.number]));
    return r.dispositivos.map((d) => ({ ...d, table_number: d.table_id ? numero.get(d.table_id) ?? null : null }));
  },

  usuarios: (lojaId) => dados<StoreUserRow[]>("usuarios", lojaId),

  async rpc(fn, params) {
    const r = await pedir<{ resultado: unknown }>(`/api/admin/rpc/${encodeURIComponent(fn)}`, json(params));
    return r.resultado;
  },

  async alterarDispositivo(id, corpo) {
    await pedir(`/api/admin/dispositivos/${encodeURIComponent(id)}`, json(corpo));
  },

  async convidar(corpo) {
    await pedir("/api/admin/usuarios", json(corpo));
  },

  async alterarUsuario(id, corpo) {
    await pedir(`/api/admin/usuarios/${encodeURIComponent(id)}`, json(corpo));
  },

  async enviarFoto(productId, arquivo) {
    const form = new FormData();
    form.set("foto", arquivo);
    const r = await pedir<{ photo_path: string }>(`/api/admin/produtos/${encodeURIComponent(productId)}/foto`, {
      method: "POST",
      body: form,
    });
    return r.photo_path;
  },
};

/** `NEXT_PUBLIC_DATA_SOURCE=supabase` liga a fonte real, como no tablet. */
export function getAdminSource(): AdminSource {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase" ? real : exemplo;
}

export function mensagemDe(erro: unknown): string {
  return erro instanceof FalhaDoAdmin ? erro.message : "Não foi possível concluir. Tente de novo.";
}
