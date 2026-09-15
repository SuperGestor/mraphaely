import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

/**
 * Manifest do tablet. Não é "adicionar à tela inicial": a instalação é do navegador
 * kiosk (NF-004). O que interessa aqui:
 *
 * - `orientation: any`, porque a tela do cliente é responsiva desde 15/09/2026 (JM-007
 *   revisto). A paisagem do tablet da mesa é travada pelo navegador kiosk (NF-018), e a
 *   tela ainda pede a `screen.orientation.lock` quando o aparelho está pareado.
 * - `display: fullscreen`, porque o cliente não deve alcançar barra de navegação
 *   nenhuma (JM-181).
 * - `start_url` aponta para a tela do cliente, e não para a raiz.
 *
 * Nome e cores são provisórios até a A1 e até a loja configurar as suas (JM-009).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.productName,
    short_name: brand.shortName,
    description: "Cardápio digital do salão, no tablet da casa.",
    start_url: "/jardim-secreto/tablet",
    scope: "/",
    display: "fullscreen",
    orientation: "any",
    background_color: "#f6f6f3",
    theme_color: "#2f3927",
    lang: "pt-BR",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
