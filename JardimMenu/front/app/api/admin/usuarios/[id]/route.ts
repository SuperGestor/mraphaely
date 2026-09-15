import { NextResponse } from "next/server";
import { alterarUsuario } from "@back/controllers/usuarios";

/**
 * POST /api/admin/usuarios/[id]
 * - { "acao": "papel", "role": "owner" | "manager" | "waiter" | "kitchen" }
 * - { "acao": "desativar" }: perde a escrita na hora (JM-052)
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  const r = await alterarUsuario(id, corpo);
  return r.ok
    ? NextResponse.json(r.dados)
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status });
}
