"use client";

import type { Uuid } from "./types";
import { normalizarSalao, type Salao } from "./salao";
import { FalhaDoAdmin, getAdminSource, type LojaDoUsuario } from "./admin-source";
import { clienteDoNavegador } from "./supabase-navegador";
import { equipeDeExemplo } from "./mock/equipe";

/**
 * Acesso a dados da tela da equipe (JM-121). Como no admin, duas implementações do mesmo
 * contrato, e a tela não sabe qual está ligada.
 *
 * As ações são a lista fechada de /api/equipe/[acao] (back/controllers/equipe.ts). Os
 * nomes e os corpos daqui têm de casar com os schemas de lá.
 */
export type AcaoDaEquipe =
  | { acao: "atender"; corpo: { call_id: Uuid } }
  | { acao: "decidir"; corpo: { request_id: Uuid; aprovar: boolean; nota: string | null } }
  | { acao: "cancelar_pedido"; corpo: { order_id: Uuid; motivo: string } }
  | { acao: "remover_item"; corpo: { item_id: Uuid; motivo: string } }
  | { acao: "encerrar_comanda"; corpo: { tab_id: Uuid } }
  | { acao: "renomear_comanda"; corpo: { tab_id: Uuid; nome: string } }
  | { acao: "migrar_comanda"; corpo: { tab_id: Uuid; mesa_id: Uuid } }
  | { acao: "fechar_mesa"; corpo: { session_id: Uuid; motivo: string } }
  | { acao: "contingencia"; corpo: { mesa_id: Uuid; pedindo: boolean; motivo: string | null } };

export interface EquipeSource {
  modo: "exemplo" | "real";
  contexto(): Promise<{ email: string | null; lojas: LojaDoUsuario[] }>;
  salao(lojaId: Uuid): Promise<Salao>;
  executar(a: AcaoDaEquipe): Promise<unknown>;
  /**
   * Avisa quando algo do salão muda (Realtime). `aoEstado(true)` quando a assinatura está
   * de pé; a tela usa isso para apertar ou afrouxar a releitura de segurança.
   */
  assinar(lojaId: Uuid, aoMudar: () => void, aoEstado: (vivo: boolean) => void): () => void;
}

async function pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, { cache: "no-store", ...init });
  } catch {
    throw new FalhaDoAdmin(0, "REDE", "Sem conexão. Confira a rede e tente de novo.");
  }
  const corpo: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const erro = corpo as { codigo?: string; mensagem?: string } | null;
    throw new FalhaDoAdmin(resposta.status, erro?.codigo ?? "JM500", erro?.mensagem ?? "Falha ao falar com o servidor.");
  }
  return corpo as T;
}

/** Tabelas publicadas no Realtime (migração da Fase B). `devices` e `tables` ficam de fora. */
const COM_LOJA = ["orders", "waiter_calls", "order_cancel_requests", "table_tabs", "table_sessions"] as const;

const real: EquipeSource = {
  modo: "real",

  contexto: () => getAdminSource().contexto(),

  async salao(lojaId) {
    return normalizarSalao(await pedir<Salao>(`/api/equipe/salao?loja=${encodeURIComponent(lojaId)}`));
  },

  async executar({ acao, corpo }) {
    const r = await pedir<{ resultado: unknown }>(`/api/equipe/${acao}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    return r.resultado;
  },

  assinar(lojaId, aoMudar, aoEstado) {
    const sb = clienteDoNavegador();
    let canal: ReturnType<typeof sb.channel> | null = null;
    let ativo = true;

    // O token do login precisa chegar ao Realtime ANTES de entrar no canal. Sem ele, a
    // entrada vai como anon, que não lê pedido nenhum (NF-005), e o servidor recusa a
    // assinatura ("Unable to subscribe to changes"): a tela ficava só na releitura de
    // segurança. A renovação do token depois disso o supabase-js repassa sozinho.
    void sb.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      const token = data.session?.access_token;
      if (!token) {
        aoEstado(false);
        return;
      }
      void sb.realtime.setAuth(token);
      canal = sb.channel(`salao:${lojaId}`);
      for (const tabela of COM_LOJA) {
        canal.on("postgres_changes", { event: "*", schema: "public", table: tabela, filter: `store_id=eq.${lojaId}` }, aoMudar);
      }
      // order_items não tem store_id: a RLS de leitura filtra pela loja do pedido.
      canal.on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, aoMudar);
      canal.subscribe((status) => aoEstado(status === "SUBSCRIBED"));
    });

    return () => {
      ativo = false;
      aoEstado(false);
      if (canal) void sb.removeChannel(canal);
    };
  },
};

export function getEquipeSource(): EquipeSource {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase" ? real : equipeDeExemplo;
}
