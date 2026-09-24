import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

/**
 * ÚNICO arquivo que lê a chave service_role (regra 4 do CLAUDE.md, decisão de 14/09/2026).
 *
 * O que ele faz, e só isso: fala com a API de administração do Supabase Auth, que não
 * aceita outra chave. O vínculo do usuário com a loja e o papel dele NÃO são gravados
 * aqui: são gravados depois pela function `admin_add_store_user`, sob o login do dono.
 * Assim a service_role nunca faz escrita de domínio.
 *
 * Duas operações moram aqui:
 *   - `convidarNoAuth`: manda o convite por e-mail. Exige SMTP configurado.
 *   - `criarContaComSenha`: cria a conta JÁ CONFIRMADA, com uma senha provisória, sem
 *     mandar e-mail nenhum.
 *
 * A segunda existe por uma decisão do dono do produto em 24/09/2026. Sem SMTP, o convite é
 * o único caminho e ele não sai — ou seja, ninguém cria conta, ninguém entra no admin e,
 * sem entrar no admin, não há como parear o tablet, porque o pareamento exige o login do
 * dono ou do gestor no próprio aparelho. Num restaurante isso nem é contorno: o garçom
 * está ali, na frente do dono, no dia em que entra.
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

/**
 * Alfabeto da senha provisória: sem os caracteres que se confundem quando alguém DITA a
 * senha para outra pessoa, que é exatamente como ela vai ser entregue. Fora: O e 0, I, l e
 * 1, S e 5. Sobra alfabeto de 50, e 14 caracteres dão cerca de 79 bits — muito acima do que
 * uma senha provisória, trocada no primeiro uso, precisa.
 */
const ALFABETO = "ABCDEFGHJKMNPQRTUVWXYZabcdefghijkmnpqrtuvwxyz2346789";

/** Sorteada com randomInt, que é do crypto: Math.random não serve para segredo. */
export function gerarSenhaProvisoria(): string {
  let senha = "";
  for (let i = 0; i < 14; i += 1) senha += ALFABETO[randomInt(ALFABETO.length)];
  return senha;
}

export type ResultadoDaConta =
  | { ok: true; userId: string }
  | { ok: false; motivo: "ambiente" | "ja_cadastrado" | "recusado" };

/**
 * Cria a conta no Auth já confirmada, com a senha provisória, e sem mandar e-mail.
 *
 * `email_confirm: true` é o que dispensa o e-mail: sem ele a conta nasce pendente e o
 * login é recusado até alguém clicar num link que não foi enviado.
 *
 * A senha entra por parâmetro, e não é sorteada aqui dentro, porque quem chama precisa
 * devolvê-la ao dono UMA vez, na resposta — o mesmo desenho do token do tablet (NF-006).
 * Ela não é gravada em lugar nenhum nosso, não vai para log e não aparece em outra
 * resposta.
 */
export async function criarContaComSenha(email: string, senha: string): Promise<ResultadoDaConta> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    return { ok: false, motivo: "ambiente" };
  }

  const admin = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  });

  if (error) {
    const jaExiste = /already|registered|exists/i.test(error.message);
    return { ok: false, motivo: jaExiste ? "ja_cadastrado" : "recusado" };
  }
  if (!data.user) {
    return { ok: false, motivo: "recusado" };
  }

  return { ok: true, userId: data.user.id };
}

/**
 * Troca a senha de uma conta que já existe, para o dono poder devolver o acesso a quem
 * esqueceu a senha. Sem SMTP não existe "esqueci minha senha" self-service, e este é o
 * caminho que resta — por isso ele é do DONO, e o controller confere isso antes de chamar.
 */
export async function trocarSenhaDaConta(userId: string, senha: string): Promise<ResultadoDaConta> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    return { ok: false, motivo: "ambiente" };
  }

  const admin = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.admin.updateUserById(userId, { password: senha });
  if (error || !data.user) return { ok: false, motivo: "recusado" };
  return { ok: true, userId: data.user.id };
}
