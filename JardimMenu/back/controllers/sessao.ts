import { z } from "zod";
import { clienteDaEquipe, supabaseConfigurado } from "../models/supabase";

/**
 * Login da equipe (§4, prompt 2 item 3), com @supabase/ssr e a chave anon.
 *
 * A mensagem de falha é a mesma para e-mail inexistente e senha errada: responder
 * diferente diria a um estranho quais e-mails têm conta.
 */
const Credenciais = z.strictObject({
  email: z.email().max(254),
  senha: z.string().min(8).max(128),
});

export type ResultadoDoLogin = { ok: true } | { ok: false; mensagem: string };

export async function entrar(dados: { email: unknown; senha: unknown }): Promise<ResultadoDoLogin> {
  if (!supabaseConfigurado()) {
    return { ok: false, mensagem: "Login indisponível: banco não configurado neste ambiente." };
  }

  const entrada = Credenciais.safeParse(dados);
  if (!entrada.success) {
    return { ok: false, mensagem: "E-mail ou senha inválidos." };
  }

  const supabase = await clienteDaEquipe();
  const { error } = await supabase.auth.signInWithPassword({
    email: entrada.data.email,
    password: entrada.data.senha,
  });

  if (error) {
    return { ok: false, mensagem: "E-mail ou senha inválidos." };
  }
  return { ok: true };
}

export async function sair(): Promise<void> {
  if (!supabaseConfigurado()) return;
  const supabase = await clienteDaEquipe();
  await supabase.auth.signOut();
}
