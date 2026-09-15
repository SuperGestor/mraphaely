import { NextResponse } from "next/server";
import { provisionarDispositivo } from "@back/controllers/dispositivos";
import { brand } from "@/lib/brand";

/**
 * POST /api/admin/dispositivos: provisiona o tablet de uma mesa (JM-180).
 * Exige login; o papel (dono ou gestor) é conferido pela function do banco.
 *
 * A resposta traz o QR de configuração com o código de uso único, e nunca o token.
 */
function origem(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_ORIGIN ?? new URL(request.url).origin ?? brand.origin;
}

export async function POST(request: Request) {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  const r = await provisionarDispositivo(corpo, origem(request));
  const headers = { "cache-control": "no-store" };
  return r.ok
    ? NextResponse.json(r.dados, { status: 201, headers })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status, headers });
}
