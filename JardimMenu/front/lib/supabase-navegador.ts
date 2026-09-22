"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase do navegador, **só para o Realtime da tela da equipe** (§8.6, NF-003).
 *
 * - Usa a chave anon, pública por desenho, e a sessão do login da equipe, que o
 *   @supabase/ssr lê dos cookies. Os eventos chegam filtrados pela RLS de leitura: cada
 *   pessoa só recebe o que o papel dela na loja deixa ler.
 * - Não escreve nada: toda escrita segue pelas rotas /api/equipe, que chamam as functions.
 * - O tablet nunca usa este cliente. Ele não é usuário do Supabase, e fica no polling de
 *   10 s (JM-012).
 */
let cliente: SupabaseClient | null = null;

export function clienteDoNavegador(): SupabaseClient {
  if (!cliente) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !chave) throw new Error("Supabase não configurado neste ambiente.");
    cliente = createBrowserClient(url, chave);
  }
  return cliente;
}
