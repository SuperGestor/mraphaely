import { z } from "zod";
import { clienteDaEquipe, clienteDeLoginAvulso, supabaseConfigurado } from "../models/supabase";
import { gerarTokenDeDispositivo, hashDoToken } from "../services/device-token";
import { traduzErro, type ErroDeRegra } from "../errors";

/**
 * Dispositivos (JM-180), com pareamento por login da equipe no próprio tablet (decisão de
 * 21/09/2026, que substituiu o código de uso único e o QR de configuração).
 *
 * 1. No tablet, o dono ou o gestor abre "Configurar este tablet", entra com e-mail e senha
 *    e informa a mesa.
 * 2. O servidor faz o login num cliente de cookies em memória, grava o pareamento sob esse
 *    login e encerra a sessão na mesma requisição: nenhum cookie da equipe chega ao tablet.
 * 3. O token em claro existe uma única vez, no corpo desta resposta. O banco guarda só o
 *    sha256 dele.
 */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: ErroDeRegra };

const SEM_BANCO: ErroDeRegra = { status: 503, codigo: "JM503", mensagem: "Banco indisponível neste ambiente." };
const ENTRADA_INVALIDA: ErroDeRegra = { status: 422, codigo: "JM422", mensagem: "Dados inválidos." };
// A mesma mensagem para e-mail inexistente e senha errada: responder diferente diria a um
// estranho quais e-mails têm conta.
const LOGIN_INVALIDO: ErroDeRegra = { status: 401, codigo: "JM401", mensagem: "E-mail ou senha inválidos." };

const Estado = z.strictObject({
  acao: z.literal("estado"),
  status: z.enum(["active", "inactive", "retired"]),
});

/** Desativa, reativa ou aposenta um tablet (admin, dono ou gestor). */
export async function alterarDispositivo(deviceId: string, corpo: unknown): Promise<Resultado<Record<string, never>>> {
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };
  if (!z.uuid().safeParse(deviceId).success) return { ok: false, erro: ENTRADA_INVALIDA };
  const entrada = Estado.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA };

  const supabase = await clienteDaEquipe();
  const { error } = await supabase.rpc("admin_set_device_status", {
    p_device_id: deviceId,
    p_status: entrada.data.status,
  });
  return error ? { ok: false, erro: traduzErro(error) } : { ok: true, dados: {} };
}

const Configurar = z.strictObject({
  loja: z.string().regex(/^[a-z0-9-]{2,40}$/),
  email: z.email().max(254),
  senha: z.string().min(8).max(128),
  mesa: z.number().int().min(1).max(9999),
  nome: z.string().trim().min(1).max(40).optional(),
});

export interface TabletConfigurado {
  token: string;
  loja: string;
  nomeDaLoja: string;
  mesa: number;
}

/**
 * Pareia o tablet com o login do dono ou do gestor. Chamada pelo tablet, sem cookie: quem
 * autoriza é o login da equipe, informado na própria tela.
 */
export async function configurarTablet(corpo: unknown): Promise<Resultado<TabletConfigurado>> {
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };
  const entrada = Configurar.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA };
  const { loja, email, senha, mesa, nome } = entrada.data;

  const supabase = clienteDeLoginAvulso();
  const { error: erroDoLogin } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (erroDoLogin) return { ok: false, erro: LOGIN_INVALIDO };

  try {
    // A RLS só mostra a loja a quem é da equipe dela: lista vazia significa "não é da
    // equipe". Erro de verdade é outra coisa, e é reportado como erro: dizer "este login
    // não é da equipe desta loja" quando o banco caiu manda a pessoa conferir o login que
    // está certo, e esconde a falha de quem precisa vê-la.
    const { data: aLoja, error: erroDaLoja } = await supabase
      .from("stores")
      .select("id, slug, name")
      .eq("slug", loja)
      .maybeSingle();
    if (erroDaLoja) return { ok: false, erro: traduzErro(erroDaLoja) };
    if (!aLoja) {
      return { ok: false, erro: { status: 403, codigo: "JM403", mensagem: "Este login não é da equipe desta loja." } };
    }

    const { data: aMesa, error: erroDaMesa } = await supabase
      .from("tables")
      .select("id, number")
      .eq("store_id", aLoja.id)
      .eq("number", mesa)
      .eq("is_active", true)
      .maybeSingle();
    if (erroDaMesa) return { ok: false, erro: traduzErro(erroDaMesa) };
    if (!aMesa) {
      return { ok: false, erro: { status: 404, codigo: "JM404", mensagem: `A mesa ${mesa} não existe nesta loja.` } };
    }

    const token = gerarTokenDeDispositivo();
    const { error } = await supabase.rpc("staff_pair_device", {
      p_store_id: aLoja.id,
      p_table_id: aMesa.id,
      p_name: nome ?? `Tablet mesa ${aMesa.number}`,
      p_token_hash: hashDoToken(token),
    });
    if (error) {
      const erro = traduzErro(error);
      return {
        ok: false,
        erro: erro.codigo === "JM403" ? { ...erro, mensagem: "Só o dono ou o gestor pareia tablet." } : erro,
      };
    }

    return { ok: true, dados: { token, loja: aLoja.slug, nomeDaLoja: aLoja.name, mesa: aMesa.number } };
  } finally {
    // Encerra só esta sessão: o login do gestor no celular dele continua valendo.
    await supabase.auth.signOut({ scope: "local" });
  }
}
