import { NextResponse } from "next/server";
import { alterarDispositivo } from "@back/controllers/dispositivos";

/**
 * POST /api/admin/dispositivos/[id]
 * - { "acao": "estado", "status": "active" | "inactive" | "retired" }
 * - { "acao": "novo_codigo" }: novo QR para o tablet que não pareou em 10 minutos
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  const origem = process.env.NEXT_PUBLIC_APP_ORIGIN ?? new URL(request.url).origin;
  const r = await alterarDispositivo(id, corpo, origem);
  const headers = { "cache-control": "no-store" };
  return r.ok
    ? NextResponse.json(r.dados, { headers })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status, headers });
}
