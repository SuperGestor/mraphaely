import { NextResponse } from "next/server";
import {
  cardapioDoTablet,
  horarioDoTablet,
  resolverDispositivo,
  totalDoItem,
} from "@back/controllers/tablet";
import { parearDispositivo } from "@back/controllers/dispositivos";

/**
 * Rotas do tablet, finas. A recusa acontece na function do banco (JM-100).
 *
 * - GET  /api/tablet/cardapio   cardápio da loja do dispositivo          (X-Device-Token)
 * - GET  /api/tablet/horario    aberta agora, no fuso da loja            (X-Device-Token)
 * - GET  /api/tablet/pareamento loja e mesa do dispositivo               (X-Device-Token)
 * - POST /api/tablet/total      total do item, calculado no banco        (X-Device-Token)
 * - POST /api/tablet/parear     troca o código de uso único pelo token   (sem login)
 *
 * `parear` é a segunda escrita anônima do sistema, ao lado de /api/track. Quem autoriza é
 * o código, gerado por um gestor logado, que vale 10 minutos e uma leitura. A resposta dela
 * é a única que carrega o token em claro, e nada aqui vai para log.
 */
type Saida = { ok: true; dados: unknown } | { ok: false; erro: { status: number; codigo: string; mensagem: string } };

function responder(r: Saida) {
  const headers = { "cache-control": "no-store" };
  if (r.ok) return NextResponse.json(r.dados, { headers });
  return NextResponse.json(
    { codigo: r.erro.codigo, mensagem: r.erro.mensagem },
    { status: r.erro.status, headers },
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ acao: string }> }) {
  const { acao } = await params;
  switch (acao) {
    case "cardapio":
      return responder(await cardapioDoTablet(request.headers));
    case "horario":
      return responder(await horarioDoTablet(request.headers));
    case "pareamento":
      return responder(await resolverDispositivo(request.headers));
    default:
      return NextResponse.json({ error: "nao encontrado" }, { status: 404 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ acao: string }> }) {
  const { acao } = await params;
  if (acao !== "total" && acao !== "parear") {
    return NextResponse.json({ error: "nao encontrado" }, { status: 404 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  return responder(acao === "total" ? await totalDoItem(request.headers, corpo) : await parearDispositivo(corpo));
}
