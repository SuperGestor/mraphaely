import { NextResponse } from "next/server";
import { executarAcaoDaEquipe } from "@back/controllers/equipe";

/**
 * POST /api/equipe/[acao]: ações da tela da equipe, com lista fechada (back/controllers/
 * equipe.ts). Exige login (middleware) e papel (a própria function do banco).
 */
export async function POST(request: Request, { params }: { params: Promise<{ acao: string }> }) {
  const { acao } = await params;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  const r = await executarAcaoDaEquipe(acao, corpo);
  const headers = { "cache-control": "no-store" };
  return r.ok
    ? NextResponse.json({ resultado: r.dados }, { headers })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status, headers });
}
