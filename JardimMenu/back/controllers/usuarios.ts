import { z } from "zod";
import { clienteDaEquipe, supabaseConfigurado } from "../models/supabase";
import { convidarNoAuth, criarContaComSenha, gerarSenhaProvisoria, trocarSenhaDaConta } from "../services/invite-user";
import { traduzErro, type ErroDeRegra } from "../errors";

/**
 * Usuários da loja (JM-052): convite, papel e desativação.
 *
 * Ordem do convite, e ela importa:
 * 1. Confere, sob o login de quem pediu, que ele é dono da loja.
 * 2. Só então cria o convite no Auth, na única operação nomeada com service_role.
 * 3. Grava o vínculo e o papel pela function, de novo sob o login do dono.
 * Sem o passo 1, qualquer usuário logado conseguiria disparar e-mail de convite.
 */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: ErroDeRegra };

const SEM_BANCO: ErroDeRegra = { status: 503, codigo: "JM503", mensagem: "Banco indisponível neste ambiente." };
const ENTRADA_INVALIDA: ErroDeRegra = { status: 422, codigo: "JM422", mensagem: "Dados inválidos." };

/**
 * E-mail com conta no Auth: o convite é recusado, e o caminho é vincular a conta à loja
 * (`admin_link_existing_user`, JM-052). Tem código próprio, e não o JM409 genérico, porque
 * a tela decide por ele se oferece o botão de vincular: o JM409 também sai de
 * `admin_add_store_user`, que é outra situação e não tem esse caminho.
 *
 * Este literal é lido no front em `front/lib/admin-source.ts` (CODIGO_CONTA_JA_EXISTE). O
 * back não é importado por tela de navegador, então a constante existe dos dois lados.
 */
const CONTA_JA_EXISTE: ErroDeRegra = {
  status: 409,
  codigo: "JMU01",
  mensagem: "Este e-mail já tem conta. Vincule a conta à loja com o papel que ela vai ter.",
};

const Papel = z.enum(["owner", "manager", "waiter", "kitchen"]);

const Convite = z.strictObject({
  store_id: z.uuid(),
  email: z.email().max(254),
  role: Papel,
});

export async function convidarUsuario(corpo: unknown, origem: string): Promise<Resultado<{ store_user_id: string }>> {
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };
  const entrada = Convite.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA };

  const supabase = await clienteDaEquipe();

  const { data: papel, error: erroPapel } = await supabase.rpc("jm_role", { p_store_id: entrada.data.store_id });
  if (erroPapel || papel !== "owner") {
    return { ok: false, erro: { status: 403, codigo: "JM403", mensagem: "Só o dono da loja convida usuários." } };
  }

  const convite = await convidarNoAuth(entrada.data.email, `${origem}/login`);
  if (!convite.ok) {
    const erro: ErroDeRegra =
      convite.motivo === "ambiente"
        ? { status: 503, codigo: "JM503", mensagem: "Convite indisponível: Auth não configurado neste ambiente." }
        : convite.motivo === "ja_cadastrado"
          ? CONTA_JA_EXISTE
          : { status: 502, codigo: "JM502", mensagem: "O Auth recusou o convite. Tente de novo em instantes." };
    return { ok: false, erro };
  }

  const { data, error } = await supabase.rpc("admin_add_store_user", {
    p_store_id: entrada.data.store_id,
    p_user_id: convite.userId,
    p_role: entrada.data.role,
  });
  if (error) return { ok: false, erro: traduzErro(error) };

  return { ok: true, dados: { store_user_id: String(data) } };
}

const Alteracao = z.discriminatedUnion("acao", [
  z.strictObject({ acao: z.literal("papel"), role: Papel }),
  z.strictObject({ acao: z.literal("desativar") }),
  // Sem SMTP não existe "esqueci minha senha" self-service. Este é o caminho de volta, e
  // ele é do dono: a senha nova volta UMA vez, e ele a entrega pessoalmente.
  z.strictObject({ acao: z.literal("nova_senha") }),
]);

export async function alterarUsuario(
  storeUserId: string,
  corpo: unknown,
): Promise<Resultado<{ senha_provisoria?: string }>> {
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };
  if (!z.uuid().safeParse(storeUserId).success) return { ok: false, erro: ENTRADA_INVALIDA };
  const entrada = Alteracao.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA };

  const supabase = await clienteDaEquipe();

  if (entrada.data.acao === "nova_senha") {
    // A leitura de store_users passa pela RLS: se quem pediu não enxerga este vínculo, não
    // há o que trocar. E o papel é conferido ANTES de tocar na service_role, como no resto
    // deste arquivo.
    const { data: vinculo, error: erroVinculo } = await supabase
      .from("store_users")
      .select("user_id, store_id")
      .eq("id", storeUserId)
      .maybeSingle();
    if (erroVinculo) return { ok: false, erro: traduzErro(erroVinculo) };
    if (!vinculo) return { ok: false, erro: { status: 404, codigo: "JM404", mensagem: "Usuário não encontrado nesta loja." } };

    const { data: papel, error: erroPapel } = await supabase.rpc("jm_role", { p_store_id: vinculo.store_id });
    if (erroPapel || papel !== "owner") {
      return { ok: false, erro: { status: 403, codigo: "JM403", mensagem: "Só o dono da loja troca a senha de alguém." } };
    }

    const senha = gerarSenhaProvisoria();
    const troca = await trocarSenhaDaConta(vinculo.user_id, senha);
    if (!troca.ok) {
      return {
        ok: false,
        erro:
          troca.motivo === "ambiente"
            ? { status: 503, codigo: "JM503", mensagem: "Troca de senha indisponível: Auth não configurado neste ambiente." }
            : { status: 502, codigo: "JM502", mensagem: "O Auth recusou a troca. Tente de novo em instantes." },
      };
    }
    return { ok: true, dados: { senha_provisoria: senha } };
  }

  const { error } =
    entrada.data.acao === "papel"
      ? await supabase.rpc("admin_set_store_user_role", { p_store_user_id: storeUserId, p_role: entrada.data.role })
      : await supabase.rpc("admin_deactivate_store_user", { p_store_user_id: storeUserId });

  return error ? { ok: false, erro: traduzErro(error) } : { ok: true, dados: {} };
}

/**
 * Cria o acesso SEM e-mail: a conta nasce confirmada, com uma senha provisória que volta
 * UMA vez nesta resposta (decisão do PO em 24/09/2026).
 *
 * A ordem é a mesma do convite, e ela importa pelo mesmo motivo: primeiro confere, sob o
 * login de quem pediu, que ele é DONO da loja; só então toca na service_role. Sem esse
 * passo, qualquer usuário logado criaria conta no Auth.
 *
 * A senha não é gravada em lugar nenhum nosso, não vai para log e não volta em nenhuma
 * outra resposta — o mesmo desenho do token do tablet (NF-006). Quem a entrega é o dono,
 * pessoalmente, a quem vai usá-la.
 */
export async function criarAcessoDeUsuario(
  corpo: unknown,
): Promise<Resultado<{ store_user_id: string; senha_provisoria: string }>> {
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };
  const entrada = Convite.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA };

  const supabase = await clienteDaEquipe();

  const { data: papel, error: erroPapel } = await supabase.rpc("jm_role", { p_store_id: entrada.data.store_id });
  if (erroPapel || papel !== "owner") {
    return { ok: false, erro: { status: 403, codigo: "JM403", mensagem: "Só o dono da loja cria acesso." } };
  }

  const senha = gerarSenhaProvisoria();
  const conta = await criarContaComSenha(entrada.data.email, senha);
  if (!conta.ok) {
    const erro: ErroDeRegra =
      conta.motivo === "ambiente"
        ? { status: 503, codigo: "JM503", mensagem: "Criação de acesso indisponível: Auth não configurado neste ambiente." }
        : conta.motivo === "ja_cadastrado"
          ? CONTA_JA_EXISTE
          : { status: 502, codigo: "JM502", mensagem: "O Auth recusou a criação. Tente de novo em instantes." };
    return { ok: false, erro };
  }

  const { data, error } = await supabase.rpc("admin_add_store_user", {
    p_store_id: entrada.data.store_id,
    p_user_id: conta.userId,
    p_role: entrada.data.role,
  });
  if (error) return { ok: false, erro: traduzErro(error) };

  return { ok: true, dados: { store_user_id: String(data), senha_provisoria: senha } };
}
