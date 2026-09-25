import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

/**
 * Service worker por Serwist (NF-004). Não `next-pwa`, que está parado para App Router
 * (CLAUDE.md).
 *
 * Em desenvolvimento ele fica desligado, senão o cache atrapalha a recarga a cada
 * mudança. A verificação do NF-004 é feita no build de produção.
 */
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // Desligado de propósito: recarregar a tela quando a rede volta descartaria a sacola
  // do cliente no meio do pedido, na Fase B. Quem recupera o app travado é o watchdog
  // (JM-184), e quem avisa da rede é a faixa de sem conexão (JM-185).
  reloadOnOnline: false,
  // Pré-cache da public/ inteira, menos as fotos do cardápio de exemplo (public/mock): elas
  // só servem sem banco, e o tablet de produção não deve baixá-las na instalação.
  globPublicPatterns: ["*", "!(mock)/**"],
});

/**
 * Versão do app no heartbeat do tablet (JM-184): a do package.json, mais o commit quando
 * quem constrói informa qual é (o publicar.sh passa `JM_COMMIT` como build arg). O admin
 * vê qual versão cada tablet está rodando, e é por ela que se sabe se um aparelho ficou
 * para trás depois de uma publicação.
 */
const versaoDoApp = (() => {
  const { version } = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };
  const commit = process.env.JM_COMMIT?.slice(0, 7);
  return commit ? `${version}+${commit}` : version;
})();

/**
 * Caminhos com sessão da equipe: os mesmos do `matcher` do middleware.ts, mais o /login,
 * que é onde a sessão nasce. Quem mudar um dos dois tem de mudar o outro.
 */
const CAMINHOS_COM_SESSAO = [
  "/login",
  "/admin",
  "/admin/:caminho*",
  "/equipe",
  "/equipe/:caminho*",
  "/api/admin/:caminho*",
  "/api/equipe/:caminho*",
];

/**
 * Trava contra o build verde que sobe o cardápio de exemplo.
 *
 * A escolha da fonte é `NEXT_PUBLIC_DATA_SOURCE === "supabase"` (lib/menu-source.ts e
 * irmãos), e QUALQUER outro valor, inclusive ausente, cai no exemplo. Isso é bom na
 * máquina de quem desenvolve e péssimo em publicação: no Netlify a variável mora num
 * painel, e esquecê-la produz um build que passa, um site que abre e um cardápio com
 * produtos que não existem — na mesa do cliente, sem nenhum erro em lugar nenhum.
 *
 * A regra: se há banco configurado (NEXT_PUBLIC_SUPABASE_URL), a fonte TEM de ser o banco.
 * Ter as duas coisas em desacordo nunca é intenção, é esquecimento.
 * A saída para quem QUER a tela de exemplo tendo um banco local no .env.local:
 * `JM_PERMITIR_EXEMPLO_COM_BANCO=sim`. É nomeada de propósito — o acidente é silencioso, e
 * a escolha deliberada tem de ser escrita.
 */
if (
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_DATA_SOURCE !== "supabase" &&
  process.env.JM_PERMITIR_EXEMPLO_COM_BANCO !== "sim"
) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL está definida, mas NEXT_PUBLIC_DATA_SOURCE não é supabase: " +
      "este build subiria o cardápio de EXEMPLO apontando para um banco de verdade. " +
      "Defina NEXT_PUBLIC_DATA_SOURCE=supabase; ou, para a tela de exemplo com um banco local, " +
      "JM_PERMITIR_EXEMPLO_COM_BANCO=sim.",
  );
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_APP_VERSION: versaoDoApp },
  /**
   * Cache-Control nas telas e rotas com sessão da equipe.
   *
   * Existe por causa do Netlify (24/09/2026). Lá o middleware vira uma Edge Function na
   * frente de uma CDN, e o `@supabase/ssr` reescreve os cookies de sessão a cada
   * requisição. Resposta que carrega `Set-Cookie` de sessão e cai num cache compartilhado
   * é sessão de uma pessoa entregue a outra — a falha silenciosa mais cara que este
   * projeto poderia ter.
   *
   * A restrição da plataforma que obriga isto a morar AQUI, e não no `netlify.toml`: os
   * `[[headers]]` do netlify.toml só valem para arquivo servido do armazenamento do
   * Netlify, e não para resposta de função, de edge function ou de SSR. Cabeçalho posto
   * aqui entra no `routes-manifest.json` do build e vale para os dois casos — o que
   * importa, porque o build marca /admin, /admin/* e /equipe como estáticas, e página
   * estática é exatamente o que uma CDN guarda por padrão.
   *
   * Isto é a SEGUNDA tranca, não a primeira. A primeira é o `setAll` do middleware aplicar
   * na resposta o segundo argumento que o `@supabase/ssr` passa desde a 0.10.0
   * (Cache-Control, Expires, Pragma); o middleware de hoje recebe só o primeiro e joga o
   * resto fora. Enquanto isso não for corrigido, quem segura é esta lista.
   *
   * No servidor próprio (`infra/docker-compose.yml`) nada piora: estas mesmas rotas já são
   * `NetworkOnly` no service worker (`app/sw.ts`), e `private` só reafirma que a resposta
   * é de um usuário só.
   */
  async headers() {
    return CAMINHOS_COM_SESSAO.map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" }],
    }));
  },
  // Servidor próprio em .next/standalone, com só as dependências que o rastreamento
  // provou necessárias. É o que a imagem Docker publica (infra/, NF-012).
  output: "standalone",
  // D33: o back/ fica ao lado do front/, fora desta pasta, e é importado só no servidor.
  experimental: { externalDir: true },
  webpack(config) {
    // Arquivos de back/ procuram pacotes subindo a partir de back/, onde não há
    // node_modules. Os pacotes do projeto moram em front/node_modules.
    // ACRESCENTA, e não substitui: substituir a lista mudava a resolução do próprio
    // React e carregava duas cópias dele no prerender.
    config.resolve.modules = [...(config.resolve.modules ?? ["node_modules"]), path.join(process.cwd(), "node_modules")];
    return config;
  },
};

export default withSerwist(nextConfig);
