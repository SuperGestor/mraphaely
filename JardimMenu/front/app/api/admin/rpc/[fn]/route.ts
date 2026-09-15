import { NextResponse } from "next/server";
import { executarRpcDoAdmin } from "@back/controllers/admin-rpc";

/**
 * POST /api/admin/rpc/[fn]: escrita do admin, com lista fechada de functions
 * (back/controllers/admin-rpc.ts). Exige login (middleware) e papel (a própria function).
 */
export async function POST(request: Request, { params }: { params: Promise<{ fn: string }> }) {
  const { fn } = await params;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  const r = await executarRpcDoAdmin(fn, corpo);
  return r.ok
    ? NextResponse.json({ resultado: r.dados })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status });
}
