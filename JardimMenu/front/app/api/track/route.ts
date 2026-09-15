import { NextResponse } from "next/server";
import { ingerirEventos } from "@back/controllers/track";

/**
 * Ingestão do pixel (JM-061). Rota fina: a regra está no controller e no banco.
 *
 * É o **único** caminho de escrita anônima da Fase A (regra 1 do CLAUDE.md).
 * `/api/orders` e `/api/staff/orders` não existem e respondem 404 até a Fase B.
 */
export async function POST(request: Request) {
  const cru = await request.text();
  const { status, corpo } = await ingerirEventos(cru, request.headers.get("content-type"));
  return NextResponse.json(corpo, { status });
}

export async function GET() {
  return NextResponse.json({ error: "metodo nao permitido" }, { status: 405 });
}
