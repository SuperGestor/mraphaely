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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_APP_VERSION: versaoDoApp },
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
