import { NextResponse } from "next/server";
import { enviarFotoDoProduto } from "@back/controllers/fotos";

/** POST /api/admin/produtos/[id]/foto, multipart com o campo `foto` (JM-002, §18.4). */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const foto = form?.get("foto");

  const r = await enviarFotoDoProduto(id, foto instanceof File ? foto : null);
  return r.ok
    ? NextResponse.json(r.dados, { status: 201 })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status });
}
