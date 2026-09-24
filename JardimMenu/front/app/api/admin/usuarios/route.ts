import { NextResponse } from "next/server";
import { convidarUsuario, criarAcessoDeUsuario } from "@back/controllers/usuarios";

/**
 * POST /api/admin/usuarios: dá acesso a alguém da equipe (JM-052). Só o dono.
 *
 * Dois caminhos, escolhidos pelo campo `modo`:
 *   - `convite`: manda e-mail com link. Exige SMTP configurado no ambiente.
 *   - `senha`: cria a conta já confirmada e devolve uma senha provisória UMA vez, sem
 *     e-mail nenhum (decisão do PO em 24/09/2026).
 *
 * O padrão é `senha`, e não `convite`, porque sem SMTP o convite não sai e ninguém entra
 * no sistema — nem o dono. Quem tiver SMTP escolhe `convite` explicitamente.
 */
export async function POST(request: Request) {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ codigo: "JM422", mensagem: "Corpo inválido." }, { status: 422 });
  }

  // O modo sai do corpo ANTES do zod do controller, que é estrito e recusaria o campo a
  // mais. Cada controller valida o que sobra, com o schema dele.
  const { modo, ...dados } = (corpo ?? {}) as { modo?: unknown };
  if (modo !== undefined && modo !== "convite" && modo !== "senha") {
    return NextResponse.json({ codigo: "JM422", mensagem: "Campo inválido: modo" }, { status: 422 });
  }

  if (modo !== "convite") {
    const criado = await criarAcessoDeUsuario(dados);
    return criado.ok
      ? NextResponse.json(criado.dados, { status: 201, headers: { "cache-control": "no-store" } })
      : NextResponse.json({ codigo: criado.erro.codigo, mensagem: criado.erro.mensagem }, { status: criado.erro.status });
  }

  const origem = process.env.NEXT_PUBLIC_APP_ORIGIN ?? new URL(request.url).origin;
  const r = await convidarUsuario(dados, origem);
  return r.ok
    ? NextResponse.json(r.dados, { status: 201 })
    : NextResponse.json({ codigo: r.erro.codigo, mensagem: r.erro.mensagem }, { status: r.erro.status });
}
