import { NextResponse } from "next/server";
import { configurarTablet } from "@back/controllers/dispositivos";

/**
 * POST /api/tablet/configurar: pareia este tablet com o login do dono ou do gestor (JM-180,
 * decisão de 21/09/2026). A equipe entra pelo servidor, e nenhum cookie de sessão volta
 * para o navegador do tablet.
 *
 * É a única resposta do sistema que carrega o token em claro, e nada aqui vai para log.
 */
export async function POST(request: Request) {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  const r = await configurarTablet(corpo);
  const headers = { "cache-control": "no-store" };
  return r.ok
    ? NextResponse.json(r.dados, { status: 201, headers })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status, headers });
}
