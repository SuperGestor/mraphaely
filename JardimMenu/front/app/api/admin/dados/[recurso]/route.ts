import { NextResponse } from "next/server";
import { lerDadosDoAdmin } from "@back/controllers/admin-dados";

/**
 * GET /api/admin/dados/[recurso]?loja=<id>
 * Recursos: contexto, loja, cardapio, mesas, dispositivos, usuarios.
 * Leitura sob o login e a RLS; nenhuma coluna de segredo é pedida.
 */
export async function GET(request: Request, { params }: { params: Promise<{ recurso: string }> }) {
  const { recurso } = await params;
  const loja = new URL(request.url).searchParams.get("loja");

  const r = await lerDadosDoAdmin(recurso, loja);
  const headers = { "cache-control": "no-store" };
  return r.ok
    ? NextResponse.json(r.dados, { headers })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status, headers });
}
