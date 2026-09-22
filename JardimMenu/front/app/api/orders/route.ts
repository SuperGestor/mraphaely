import { NextResponse } from "next/server";
import { enviarPedido } from "@back/controllers/tablet";

/**
 * POST /api/orders: pedido do tablet (JM-031, JM-032, JM-100). Exige `X-Device-Token` e
 * `Idempotency-Key`. O corpo tem só identificadores, quantidade e observação por item; o
 * preço, o número do pedido e o turno saem do banco, que também é quem recusa.
 *
 * Fica de fora, até a Fase C, o pedido lançado pela equipe (/api/staff/orders, JM-110).
 */
export async function POST(request: Request) {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  const r = await enviarPedido(request.headers, corpo);
  const headers = { "cache-control": "no-store" };
  return r.ok
    ? NextResponse.json(r.dados, { status: 201, headers })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status, headers });
}
