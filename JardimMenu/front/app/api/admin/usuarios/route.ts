import { NextResponse } from "next/server";
import { convidarUsuario } from "@back/controllers/usuarios";

/** POST /api/admin/usuarios: convite de usuário da loja (JM-052). Só o dono. */
export async function POST(request: Request) {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  const origem = process.env.NEXT_PUBLIC_APP_ORIGIN ?? new URL(request.url).origin;
  const r = await convidarUsuario(corpo, origem);
  return r.ok
    ? NextResponse.json(r.dados, { status: 201 })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status });
}
