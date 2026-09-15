import type { ItemSelection, ItemTotal, Menu, StoreHours, Uuid } from "./types";
import { mockMenuSource } from "./mock/menu";
import { tabletMenuSource } from "./tablet-source";

/**
 * Como o pedido sai do tablet.
 * - `demonstracao`: fonte de exemplo. Simula o envio para mostrar o fluxo inteiro, sem
 *   gravar nada e sem chamar rota nenhuma.
 * - `fase-b`: fonte real. O envio ainda não existe: o pedido é da Fase B (prompt 3), e a
 *   regra 1 do CLAUDE.md não abre escrita de cliente antes dela.
 */
export type ModoDeEnvio = "demonstracao" | "fase-b";

/**
 * Camada única de acesso a dados do cardápio.
 *
 * Duas implementações do mesmo contrato: a de exemplo (A1) e a real (A2, rotas
 * /api/tablet/* sobre as functions do banco). Nenhum componente importa uma delas direto.
 */
export interface MenuSource {
  getMenu(storeSlug: string): Promise<Menu>;

  /** Horário resolvido no banco (regra 5, D12). O front nunca calcula fuso. */
  getHours(storeId: Uuid): Promise<StoreHours>;

  /** Total do item calculado no servidor (regra 6, JM-031). O front só exibe. */
  getItemTotal(selection: ItemSelection): Promise<ItemTotal>;

  readonly envio: ModoDeEnvio;

  /**
   * Envia a sacola: o tablet manda só identificadores, quantidade e observação (JM-031).
   * Recusa com `PedidoRecusado` (lib/sacola.ts), que traz código estável (JM-100).
   */
  enviarPedido(itens: ItemSelection[]): Promise<{ numero: number }>;
}

/**
 * `NEXT_PUBLIC_DATA_SOURCE=supabase` liga a fonte real. Sem a variável, fica a de exemplo,
 * para o front continuar abrindo em ambiente sem banco.
 */
export function getMenuSource(): MenuSource {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase" ? tabletMenuSource : mockMenuSource;
}
