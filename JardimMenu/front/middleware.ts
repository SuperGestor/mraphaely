import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Sessão da equipe (@supabase/ssr), nas páginas /admin e nas rotas /api/admin.
 *
 * 1. Renova o token de login nos cookies a cada requisição.
 * 2. Sem login: página vai para /login, e rota de API responde 401.
 *
 * A autorização por papel NÃO mora aqui: ela está em cada function do banco, que confere
 * o papel na loja. Isto é defesa em profundidade, e não a trava.
 *
 * Sem Supabase configurado: em desenvolvimento o admin abre sobre os dados de exemplo; em
 * produção ele responde 503, para nunca subir um admin aberto por falta de variável.
 */
export async function middleware(request: NextRequest) {
  const ehApi = request.nextUrl.pathname.startsWith("/api/");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !chave) {
    if (process.env.NODE_ENV === "production") {
      return ehApi
        ? NextResponse.json({ codigo: "JM503", mensagem: "Banco não configurado." }, { status: 503 })
        : new NextResponse("Admin indisponível: banco não configurado neste ambiente.", { status: 503 });
    }
    return NextResponse.next();
  }

  let resposta = NextResponse.next({ request });

  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista: { name: string; value: string; options: CookieOptions }[]) => {
        lista.forEach(({ name, value }) => request.cookies.set(name, value));
        resposta = NextResponse.next({ request });
        lista.forEach(({ name, value, options }) => resposta.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (ehApi) {
      return NextResponse.json({ codigo: "JM401", mensagem: "Faça login." }, { status: 401 });
    }
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    destino.searchParams.set("de", request.nextUrl.pathname);
    return NextResponse.redirect(destino);
  }

  return resposta;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/equipe/:path*", "/api/equipe/:path*"],
};
