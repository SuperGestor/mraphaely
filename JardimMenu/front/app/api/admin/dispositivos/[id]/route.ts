import { NextResponse } from "next/server";
import { alterarDispositivo } from "@back/controllers/dispositivos";

/**
 * POST /api/admin/dispositivos/[id] com `{ "acao": "estado", "status": "active" | "inactive" |
 * "retired" }`: desativa, reativa ou aposenta um tablet. Parear é no próprio tablet, com o
 * login do dono ou do gestor (/api/tablet/configurar).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  const r = await alterarDispositivo(id, corpo);
  const headers = { "cache-control": "no-store" };
  return r.ok
    ? NextResponse.json(r.dados, { headers })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status, headers });
}
