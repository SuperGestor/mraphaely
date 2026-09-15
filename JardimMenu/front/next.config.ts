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

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
