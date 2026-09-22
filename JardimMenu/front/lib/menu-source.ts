import type { ItemSelection, ItemTotal, Menu, StoreHours, Uuid } from "./types";
import type { ChamadoDeGarcom, EnvioDoPedido, PedidoEnviado, ResumoDaMesa, SessaoDaMesa } from "./mesa";
import { mockMenuSource } from "./mock/menu";
import { tabletMenuSource } from "./tablet-source";

/**
 * Como o pedido sai do tablet.
 * - `demonstracao`: fonte de exemplo. Simula a mesa inteira (envio, conta, garçom), sem
 *   gravar nada e sem chamar rota nenhuma.
 * - `real`: fonte real, pelas rotas /api/tablet/* e /api/orders, com o banco decidindo.
 */
export type ModoDeEnvio = "demonstracao" | "real";

/**
 * Camada única de acesso a dados do tablet.
 *
 * Duas implementações do mesmo contrato: a de exemplo e a real. Nenhum componente importa
 * uma delas direto. As recusas chegam como `PedidoRecusado` (lib/sacola.ts), com o código
 * estável do JM-100, e o tablet sem pareamento válido como `TabletNaoPareado`.
 */
export interface MenuSource {
  readonly envio: ModoDeEnvio;

  getMenu(storeSlug: string): Promise<Menu>;

  /** Horário resolvido no banco (regra 5, D12). O front nunca calcula fuso. */
  getHours(storeId: Uuid): Promise<StoreHours>;

  /** Total do item calculado no servidor (regra 6, JM-031). O front só exibe. */
  getItemTotal(selection: ItemSelection): Promise<ItemTotal>;

  /** Primeiro toque: abre a abertura da mesa, ou devolve a que existe (JM-182). */
  abrirMesa(): Promise<SessaoDaMesa>;

  /** Comanda com nome, no modo nomeada (JM-201). */
  criarComanda(nome: string): Promise<{ id: Uuid; name: string; session_id: Uuid }>;

  /** O que foi pedido pela mesa, para o polling de 10 s (JM-011, JM-012). */
  resumo(): Promise<ResumoDaMesa>;

  /** Envia a sacola com a chave de idempotência da tentativa (JM-032). */
  enviarPedido(envio: EnvioDoPedido, chaveDeIdempotencia: string): Promise<PedidoEnviado>;

  /** O cliente pede o cancelamento do pedido inteiro ou de um item (JM-111). */
  pedirCancelamento(orderId: Uuid, itemId: Uuid | null): Promise<void>;

  /** Chamado de garçom, o caminho garantido (JM-187). */
  chamarGarcom(): Promise<ChamadoDeGarcom>;

  /** Reforço do chamado, depois de 3 min sem atendimento (JM-040). */
  reforcarChamado(callId: Uuid): Promise<ChamadoDeGarcom>;

  /** Último contato, versão e bateria (JM-184). */
  heartbeat(dados: { versao: string | null; bateria: number | null }): Promise<void>;
}

/**
 * `NEXT_PUBLIC_DATA_SOURCE=supabase` liga a fonte real. Sem a variável, fica a de exemplo,
 * para o front continuar abrindo em ambiente sem banco.
 */
export function getMenuSource(): MenuSource {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase" ? tabletMenuSource : mockMenuSource;
}
