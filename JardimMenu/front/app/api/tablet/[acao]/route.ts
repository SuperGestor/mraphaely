import { NextResponse } from "next/server";
import {
  abrirMesa,
  cardapioDoTablet,
  chamarGarcom,
  criarComanda,
  heartbeat,
  horarioDoTablet,
  pedirCancelamento,
  reforcarChamado,
  resolverDispositivo,
  resumoDaMesa,
  totalDoItem,
} from "@back/controllers/tablet";

/**
 * Rotas do tablet, finas. Todas com `X-Device-Token`, e a recusa acontece na function do
 * banco (JM-100).
 *
 * - GET  /api/tablet/cardapio      cardápio da loja do dispositivo
 * - GET  /api/tablet/horario       aberta agora, no fuso da loja
 * - GET  /api/tablet/pareamento    loja e mesa do dispositivo
 * - GET  /api/tablet/resumo        o que a mesa pediu, para o polling de 10 s (JM-011)
 * - POST /api/tablet/total         total do item, calculado no banco
 * - POST /api/tablet/abrir         primeiro toque: abre a abertura da mesa (JM-182)
 * - POST /api/tablet/comanda       comanda com nome, no modo nomeada (JM-201)
 * - POST /api/tablet/cancelamento  pedido de cancelamento pelo cliente (JM-111)
 * - POST /api/tablet/garcom        chamado de garçom (JM-038, JM-187)
 * - POST /api/tablet/reforco       reforço do chamado, depois de 3 min (JM-040)
 * - POST /api/tablet/heartbeat     último contato, versão e bateria (JM-184)
 *
 * O pedido é /api/orders, e o pareamento é /api/tablet/configurar, com o login do dono ou
 * do gestor (decisão de 21/09/2026).
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

const NAO_ENCONTRADO = () => NextResponse.json({ error: "nao encontrado" }, { status: 404 });

export async function GET(request: Request, { params }: { params: Promise<{ acao: string }> }) {
  const { acao } = await params;
  switch (acao) {
    case "cardapio":
      return responder(await cardapioDoTablet(request.headers));
    case "horario":
      return responder(await horarioDoTablet(request.headers));
    case "pareamento":
      return responder(await resolverDispositivo(request.headers));
    case "resumo":
      return responder(await resumoDaMesa(request.headers));
    default:
      return NAO_ENCONTRADO();
  }
}

const COM_CORPO = new Set(["total", "comanda", "cancelamento", "reforco", "heartbeat"]);
const SEM_CORPO = new Set(["abrir", "garcom"]);

export async function POST(request: Request, { params }: { params: Promise<{ acao: string }> }) {
  const { acao } = await params;
  if (!COM_CORPO.has(acao) && !SEM_CORPO.has(acao)) return NAO_ENCONTRADO();

  if (acao === "abrir") return responder(await abrirMesa(request.headers));
  if (acao === "garcom") return responder(await chamarGarcom(request.headers));

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  switch (acao) {
    case "total":
      return responder(await totalDoItem(request.headers, corpo));
    case "comanda":
      return responder(await criarComanda(request.headers, corpo));
    case "cancelamento":
      return responder(await pedirCancelamento(request.headers, corpo));
    case "reforco":
      return responder(await reforcarChamado(request.headers, corpo));
    default:
      return responder(await heartbeat(request.headers, corpo));
  }
}
