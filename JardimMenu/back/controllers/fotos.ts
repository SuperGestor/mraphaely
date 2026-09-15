import sharp from "sharp";
import { z } from "zod";
import { clienteDaEquipe, supabaseConfigurado } from "../models/supabase";
import { traduzErro, type ErroDeRegra } from "../errors";

/**
 * Upload de foto de produto (JM-002, §18.4, prompt 2 item 4).
 *
 * - Aceita JPEG, PNG ou WebP de até 400 KB, com no mínimo 800 px no menor lado (§18.4).
 * - Corta em proporção fixa de 4:3, com o recorte centrado no que tem mais detalhe.
 * - Gera as três larguras servidas, cada uma dentro do seu teto, em WebP:
 *   grade 400 px (45 KB), vitrine 600 px (70 KB) e modal 900 px (120 KB).
 * - Grava no Storage sob o login do gestor, na pasta da loja, e só depois aponta o
 *   produto para a nova versão. Foto antiga não é sobrescrita: versão nova, pasta nova.
 */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: ErroDeRegra };

const LIMITE_UPLOAD = 400 * 1024;
const MENOR_LADO = 800;
const PROPORCAO = 4 / 3;
const TIPOS = ["image/jpeg", "image/png", "image/webp"];
const LARGURAS = [
  { nome: "grade", largura: 400, teto: 45 * 1024 },
  { nome: "vitrine", largura: 600, teto: 70 * 1024 },
  { nome: "modal", largura: 900, teto: 120 * 1024 },
] as const;

const recusa = (mensagem: string, status = 422, codigo = "JM422"): Resultado<never> => ({
  ok: false,
  erro: { status, codigo, mensagem },
});

/** Qualidade decrescente até caber no teto. Nulo se nem a qualidade mínima coube. */
async function webpNoTeto(entrada: Buffer, largura: number, teto: number): Promise<Buffer | null> {
  for (let qualidade = 82; qualidade >= 40; qualidade -= 6) {
    const saida = await sharp(entrada)
      .rotate()
      .resize({ width: largura, height: Math.round(largura / PROPORCAO), fit: "cover", position: "attention" })
      .webp({ quality: qualidade })
      .toBuffer();
    if (saida.length <= teto) return saida;
  }
  return null;
}

export async function enviarFotoDoProduto(
  productId: string,
  arquivo: File | null,
): Promise<Resultado<{ photo_path: string }>> {
  if (!supabaseConfigurado()) return recusa("Banco indisponível neste ambiente.", 503, "JM503");
  if (!z.uuid().safeParse(productId).success) return recusa("Produto inválido.");
  if (!arquivo) return recusa("Nenhuma foto enviada.");
  if (!TIPOS.includes(arquivo.type)) return recusa("Formato não aceito: use JPEG, PNG ou WebP.");
  if (arquivo.size > LIMITE_UPLOAD) return recusa("A foto passa de 400 KB. Reduza e envie de novo.");

  const buffer = Buffer.from(await arquivo.arrayBuffer());

  let largura = 0;
  let altura = 0;
  try {
    const meta = await sharp(buffer).rotate().metadata();
    largura = meta.width ?? 0;
    altura = meta.height ?? 0;
  } catch {
    return recusa("O arquivo não é uma imagem válida.");
  }
  if (Math.min(largura, altura) < MENOR_LADO) {
    return recusa(`A foto precisa de no mínimo ${MENOR_LADO} px no menor lado. Esta tem ${Math.min(largura, altura)} px.`);
  }

  const supabase = await clienteDaEquipe();
  const { data: produto } = await supabase.from("products").select("id, store_id").eq("id", productId).maybeSingle();
  if (!produto) return recusa("Produto não encontrado.", 404, "JM404");

  const prefixo = `${produto.store_id}/${produto.id}/v${Date.now()}`;

  for (const alvo of LARGURAS) {
    const webp = await webpNoTeto(buffer, alvo.largura, alvo.teto);
    if (!webp) {
      return recusa(`A foto não coube em ${alvo.teto / 1024} KB na largura de ${alvo.largura} px. Tente outra foto.`);
    }
    const { error } = await supabase.storage
      .from("produtos")
      .upload(`${prefixo}/${alvo.nome}.webp`, webp, { contentType: "image/webp", upsert: false });
    if (error) return recusa("O Storage recusou o envio. Confira seu papel na loja.", 403, "JM403");
  }

  const { error } = await supabase.rpc("admin_set_product_photo", {
    p_product_id: produto.id,
    p_photo_path: prefixo,
  });
  if (error) return { ok: false, erro: traduzErro(error) };

  return { ok: true, dados: { photo_path: prefixo } };
}
