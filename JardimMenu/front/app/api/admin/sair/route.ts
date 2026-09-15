import { NextResponse } from "next/server";
import { sair } from "@back/controllers/sessao";

/** POST /api/admin/sair: encerra o login da equipe e volta para /login. */
export async function POST(request: Request) {
  await sair();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
