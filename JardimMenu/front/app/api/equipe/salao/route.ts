import { NextResponse } from "next/server";
import { salao } from "@back/controllers/equipe";

/** GET /api/equipe/salao?loja=<id>: retrato do salão para a tela da equipe (JM-121). */
export async function GET(request: Request) {
  const loja = new URL(request.url).searchParams.get("loja");
  const r = await salao(loja);
  const headers = { "cache-control": "no-store" };
  return r.ok
    ? NextResponse.json(r.dados, { headers })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status, headers });
}
