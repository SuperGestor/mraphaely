import QRCode from "qrcode";
import { z } from "zod";
import { clienteAnonimo, clienteDaEquipe, supabaseConfigurado } from "../models/supabase";
import { gerarTokenDeDispositivo, hashDoToken } from "../services/device-token";
import { traduzErro, type ErroDeRegra } from "../errors";

/**
 * Dispositivos (JM-180), com pareamento por código de uso único (decisão de 14/09/2026).
 *
 * 1. O gestor provisiona: nasce o dispositivo com um CÓDIGO que vale 10 minutos e uma
 *    leitura. O QR de configuração carrega a URL de pareamento com esse código.
 * 2. O tablet lê o QR com a própria câmera, e a tela de pareamento troca o código pelo
 *    token permanente. O token só existe no corpo dessa resposta, uma única vez.
 *
 * O banco nunca vê nem o código nem o token em claro: só o sha256 dos dois.
 */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: ErroDeRegra };

const SEM_BANCO: ErroDeRegra = { status: 503, codigo: "JM503", mensagem: "Banco indisponível neste ambiente." };
const ENTRADA_INVALIDA: ErroDeRegra = { status: 422, codigo: "JM422", mensagem: "Dados inválidos." };

interface Pareamento {
  qr: string;
  url: string;
  expiraEm: string;
}

async function montarPareamento(origem: string, slug: string, codigo: string, expiraEm: string): Promise<Pareamento> {
  const url = `${origem}/${slug}/tablet/setup?codigo=${codigo}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: "M" });
  return { qr, url, expiraEm };
}

async function slugDaLoja(storeId: string): Promise<string | null> {
  const supabase = await clienteDaEquipe();
  const { data } = await supabase.from("stores").select("slug").eq("id", storeId).maybeSingle();
  return data?.slug ?? null;
}

const Provisionar = z.strictObject({
  store_id: z.uuid(),
  table_id: z.uuid(),
  name: z.string().trim().min(1).max(40),
});

export async function provisionarDispositivo(
  corpo: unknown,
  origem: string,
): Promise<Resultado<{ dispositivo: Record<string, unknown>; pareamento: Pareamento }>> {
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };
  const entrada = Provisionar.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA };

  const codigo = gerarTokenDeDispositivo();
  const supabase = await clienteDaEquipe();
  const { data, error } = await supabase.rpc("admin_provision_device", {
    p_store_id: entrada.data.store_id,
    p_table_id: entrada.data.table_id,
    p_name: entrada.data.name,
    p_pairing_code_hash: hashDoToken(codigo),
  });
  if (error) return { ok: false, erro: traduzErro(error) };

  const linha = (Array.isArray(data) ? data[0] : null) as Record<string, unknown> | null;
  const slug = await slugDaLoja(entrada.data.store_id);
  if (!linha || !slug) return { ok: false, erro: traduzErro(null) };

  return {
    ok: true,
    dados: {
      dispositivo: linha,
      pareamento: await montarPareamento(origem, slug, codigo, String(linha.pairing_expires_at)),
    },
  };
}

const Acao = z.discriminatedUnion("acao", [
  z.strictObject({ acao: z.literal("estado"), status: z.enum(["active", "inactive", "retired"]) }),
  z.strictObject({ acao: z.literal("novo_codigo") }),
]);

export async function alterarDispositivo(
  deviceId: string,
  corpo: unknown,
  origem: string,
): Promise<Resultado<{ pareamento?: Pareamento }>> {
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };
  if (!z.uuid().safeParse(deviceId).success) return { ok: false, erro: ENTRADA_INVALIDA };
  const entrada = Acao.safeParse(corpo);
  if (!entrada.success) return { ok: false, erro: ENTRADA_INVALIDA };

  const supabase = await clienteDaEquipe();

  if (entrada.data.acao === "estado") {
    const { error } = await supabase.rpc("admin_set_device_status", {
      p_device_id: deviceId,
      p_status: entrada.data.status,
    });
    return error ? { ok: false, erro: traduzErro(error) } : { ok: true, dados: {} };
  }

  const codigo = gerarTokenDeDispositivo();
  const { data: expira, error } = await supabase.rpc("admin_renew_pairing_code", {
    p_device_id: deviceId,
    p_pairing_code_hash: hashDoToken(codigo),
  });
  if (error) return { ok: false, erro: traduzErro(error) };

  const { data: dispositivo } = await supabase.from("devices").select("store_id").eq("id", deviceId).maybeSingle();
  const slug = dispositivo ? await slugDaLoja(dispositivo.store_id) : null;
  if (!slug) return { ok: false, erro: traduzErro(null) };

  return { ok: true, dados: { pareamento: await montarPareamento(origem, slug, codigo, String(expira)) } };
}

const Parear = z.strictObject({ codigo: z.string().regex(/^[A-Za-z0-9_-]{22}$/) });

/**
 * A troca do código pelo token. Chamada pelo tablet, sem login: quem autoriza é o código.
 * Esta é a ÚNICA resposta do sistema que carrega o token em claro.
 */
export async function parearDispositivo(
  corpo: unknown,
): Promise<Resultado<{ token: string; loja: string; nomeDaLoja: string; mesa: number | null }>> {
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };
  const entrada = Parear.safeParse(corpo);
  if (!entrada.success) {
    return { ok: false, erro: { status: 401, codigo: "JM401", mensagem: "Código de pareamento inválido ou vencido." } };
  }

  const token = gerarTokenDeDispositivo();
  const { data, error } = await clienteAnonimo().rpc("tablet_pair_device", {
    p_pairing_code_hash: hashDoToken(entrada.data.codigo),
    p_token_hash: hashDoToken(token),
  });
  if (error) {
    const erro = traduzErro(error);
    return {
      ok: false,
      erro: erro.codigo === "JM401" ? { ...erro, mensagem: "Código de pareamento inválido ou vencido." } : erro,
    };
  }

  const linha = (Array.isArray(data) ? data[0] : null) as
    | { store_slug: string; store_name: string; table_number: number | null }
    | null;
  if (!linha) return { ok: false, erro: traduzErro(null) };

  return {
    ok: true,
    dados: { token, loja: linha.store_slug, nomeDaLoja: linha.store_name, mesa: linha.table_number },
  };
}
