import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/**
 * Os dois clientes de banco do servidor. Nenhum deles usa a chave service_role: ela vive
 * em um único arquivo nomeado (back/services/invite-user.ts), só para o convite no Auth.
 */

function variavel(nome: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY"): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`variavel de ambiente ausente: ${nome}`);
  }
  return valor;
}

/** Supabase configurado neste ambiente? Sem ele, as rotas respondem 503, e não 500. */
export function supabaseConfigurado(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Cliente sob o login do usuário da equipe (@supabase/ssr), com a chave anon e a RLS
 * valendo. Toda escrita do admin passa por function, e a function confere o papel.
 */
export async function clienteDaEquipe() {
  const jar = await cookies();
  return createServerClient(variavel("NEXT_PUBLIC_SUPABASE_URL"), variavel("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lista: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          lista.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          // Chamado de Server Component, onde cookie é só leitura: o middleware renova.
        }
      },
    },
  });
}

/**
 * Cliente de login avulso, com os cookies num pote em memória que morre com a requisição.
 * É o do pareamento do tablet (decisão de 21/09/2026): o dono ou o gestor entra pelo
 * servidor, o pareamento é gravado sob o login dele, e nenhum cookie da equipe chega ao
 * navegador do tablet.
 */
export function clienteDeLoginAvulso() {
  const pote = new Map<string, string>();
  return createServerClient(variavel("NEXT_PUBLIC_SUPABASE_URL"), variavel("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => [...pote].map(([name, value]) => ({ name, value })),
      setAll: (lista: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value } of lista) {
          if (value) pote.set(name, value);
          else pote.delete(name);
        }
      },
    },
  });
}

/**
 * Cliente anônimo, para as functions do tablet e do pixel. Sem sessão e sem cookie: o
 * tablet não é usuário do Supabase, e quem prova presença é o hash do device_token.
 */
export function clienteAnonimo() {
  return createClient(variavel("NEXT_PUBLIC_SUPABASE_URL"), variavel("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
