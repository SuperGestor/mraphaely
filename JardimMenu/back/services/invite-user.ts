import { createClient } from "@supabase/supabase-js";

/**
 * ÚNICA operação nomeada com a chave service_role (regra 4 do CLAUDE.md, decisão de
 * 14/09/2026).
 *
 * O que ela faz, e só isso: cria o convite no Supabase Auth, porque a API de convite não
 * aceita outra chave. O vínculo do usuário com a loja e o papel dele NÃO são gravados
 * aqui: são gravados depois pela function `admin_add_store_user`, sob o login do dono.
 * Assim a service_role nunca faz escrita de domínio.
 *
 * Um teste falha se o nome da variável da chave aparecer em qualquer outro arquivo, ou se
 * a chave aparecer no bundle publicado.
 */
export type ResultadoDoConvite =
  | { ok: true; userId: string }
  | { ok: false; motivo: "ambiente" | "ja_cadastrado" | "recusado" };

export async function convidarNoAuth(email: string, redirectTo: string): Promise<ResultadoDoConvite> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    return { ok: false, motivo: "ambiente" };
  }

  const admin = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

  if (error) {
    const jaExiste = /already|registered|exists/i.test(error.message);
    return { ok: false, motivo: jaExiste ? "ja_cadastrado" : "recusado" };
  }
  if (!data.user) {
    return { ok: false, motivo: "recusado" };
  }

  return { ok: true, userId: data.user.id };
}
