import { z } from "zod";
import { clienteDaEquipe, supabaseConfigurado } from "../models/supabase";
import { traduzErro, type ErroDeRegra } from "../errors";

/**
 * Leitura do admin, sob o login do usuário e a RLS (§8 do plano de schema).
 *
 * As colunas são sempre listadas uma a uma, nunca `*`: `devices.token_hash`,
 * `devices.pairing_code_hash` e `tables.qr_token` não têm privilégio de leitura, e um
 * `select *` falharia em vez de vazar. Listar é o que deixa isso explícito (NF-006).
 */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: ErroDeRegra };

const SEM_BANCO: ErroDeRegra = { status: 503, codigo: "JM503", mensagem: "Banco indisponível neste ambiente." };
const LOJA_INVALIDA: ErroDeRegra = { status: 422, codigo: "JM422", mensagem: "Loja inválida." };

const COLUNAS_DA_MESA = "id, store_id, number, label, is_active, ordering_enabled, created_at";
const COLUNAS_DO_DISPOSITIVO =
  "id, store_id, table_id, name, kind, status, app_version, battery_level, last_seen_at, provisioned_at, retired_at, is_paired, pairing_expires_at";

export async function lerDadosDoAdmin(recurso: string, lojaId: string | null): Promise<Resultado<unknown>> {
  if (!supabaseConfigurado()) return { ok: false, erro: SEM_BANCO };
  const supabase = await clienteDaEquipe();

  if (recurso === "contexto") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, erro: { status: 401, codigo: "JM401", mensagem: "Faça login." } };

    const { data, error } = await supabase
      .from("store_users")
      .select("id, store_id, role, stores(id, name, slug)")
      .eq("user_id", user.id)
      .eq("is_active", true);
    if (error) return { ok: false, erro: traduzErro(error) };
    return { ok: true, dados: { email: user.email ?? null, lojas: data ?? [] } };
  }

  if (!z.uuid().safeParse(lojaId).success) return { ok: false, erro: LOJA_INVALIDA };
  const loja = lojaId as string;

  switch (recurso) {
    case "loja": {
      const { data, error } = await supabase
        .from("stores")
        .select("id, slug, name, timezone, business_day_start, opening_hours, tab_mode, logo_url, primary_color, accent_color")
        .eq("id", loja)
        .maybeSingle();
      if (error) return { ok: false, erro: traduzErro(error) };
      return data ? { ok: true, dados: data } : { ok: false, erro: { status: 404, codigo: "JM404", mensagem: "Loja não encontrada." } };
    }

    case "cardapio": {
      const [categorias, produtos, grupos] = await Promise.all([
        supabase.from("categories").select("id, store_id, name, sort_order, is_active").eq("store_id", loja).order("sort_order"),
        supabase
          .from("products")
          .select(
            "id, store_id, category_id, name, description, price, photo_path, emoji, is_featured, is_available, unavailable_since, available_window, pdv_code, sort_order, is_active",
          )
          .eq("store_id", loja)
          .order("sort_order"),
        supabase
          .from("option_groups")
          .select("id, store_id, name, min_select, max_select, options(id, group_id, name, price_delta, pdv_code, is_available, sort_order)")
          .eq("store_id", loja)
          .order("name"),
      ]);
      const erro = categorias.error ?? produtos.error ?? grupos.error;
      if (erro) return { ok: false, erro: traduzErro(erro) };

      const idsDosProdutos = (produtos.data ?? []).map((p) => p.id);
      const ligacoes = idsDosProdutos.length
        ? await supabase.from("product_option_groups").select("product_id, group_id, sort_order").in("product_id", idsDosProdutos)
        : { data: [], error: null };
      if (ligacoes.error) return { ok: false, erro: traduzErro(ligacoes.error) };

      return {
        ok: true,
        dados: {
          categorias: categorias.data ?? [],
          produtos: produtos.data ?? [],
          grupos: grupos.data ?? [],
          ligacoes: ligacoes.data ?? [],
        },
      };
    }

    case "mesas": {
      const [mesas, dispositivos] = await Promise.all([
        supabase.from("tables").select(COLUNAS_DA_MESA).eq("store_id", loja).order("number"),
        supabase.from("devices").select(COLUNAS_DO_DISPOSITIVO).eq("store_id", loja).eq("status", "active"),
      ]);
      const erro = mesas.error ?? dispositivos.error;
      if (erro) return { ok: false, erro: traduzErro(erro) };
      return { ok: true, dados: { mesas: mesas.data ?? [], dispositivos: dispositivos.data ?? [] } };
    }

    case "dispositivos": {
      const [dispositivos, mesas] = await Promise.all([
        supabase.from("devices").select(COLUNAS_DO_DISPOSITIVO).eq("store_id", loja).order("provisioned_at", { ascending: false }),
        supabase.from("tables").select("id, number, label").eq("store_id", loja).order("number"),
      ]);
      const erro = dispositivos.error ?? mesas.error;
      if (erro) return { ok: false, erro: traduzErro(erro) };
      return { ok: true, dados: { dispositivos: dispositivos.data ?? [], mesas: mesas.data ?? [] } };
    }

    case "usuarios": {
      const { data, error } = await supabase.rpc("admin_list_store_users", { p_store_id: loja });
      if (error) return { ok: false, erro: traduzErro(error) };
      return { ok: true, dados: data ?? [] };
    }

    default:
      return { ok: false, erro: { status: 404, codigo: "JM404", mensagem: "Recurso inexistente." } };
  }
}
