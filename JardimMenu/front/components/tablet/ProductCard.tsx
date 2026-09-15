"use client";

import type { MenuProduct } from "@/lib/types";
import { money } from "@/lib/money";
import { urlDaFoto, type LarguraDaFoto } from "@/lib/foto";

/** Variantes do Ken Burns alternadas por posição, para o movimento não sincronizar. */
const kenBurns = ["jm-ken-a", "jm-ken-b", "jm-ken-c"] as const;

/**
 * Foto do produto, na largura servida (§18.4), ou o placeholder da paleta com emoji
 * quando o produto não tem foto (JM-002): nunca um quadrado cinza.
 *
 * O `alt` é vazio de propósito: o nome do produto já está escrito logo abaixo, e ler os
 * dois seria repetir.
 */
function Imagem({
  produto,
  indice,
  altura,
  largura,
}: {
  produto: MenuProduct;
  indice: number;
  altura: string;
  largura: LarguraDaFoto;
}) {
  const url = urlDaFoto(produto.photo_path, largura);

  if (url) {
    return (
      <div className={`${altura} w-full overflow-hidden`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- foto já otimizada no upload, servida pelo Storage */}
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className={`${kenBurns[indice % 3]} h-full w-full object-cover`}
        />
      </div>
    );
  }

  return (
    <div
      className={`${altura} flex w-full items-center justify-center overflow-hidden`}
      style={{
        background: `linear-gradient(135deg, color-mix(in oklab, var(--jm-primary) 18%, white), color-mix(in oklab, var(--jm-accent) 30%, white))`,
      }}
    >
      <span className={`${kenBurns[indice % 3]} text-6xl`} aria-hidden="true">
        {produto.emoji ?? "🌿"}
      </span>
    </div>
  );
}

export function ProductCard({
  produto,
  indice,
  onAbrir,
}: {
  produto: MenuProduct;
  indice: number;
  onAbrir: (produto: MenuProduct) => void;
}) {
  const indisponivel = !produto.is_available;

  return (
    <button
      type="button"
      onClick={() => onAbrir(produto)}
      disabled={indisponivel}
      aria-disabled={indisponivel}
      className={`jm-focus rounded-card bg-surface shadow-card flex h-full flex-col overflow-hidden text-left transition-transform active:scale-[0.99] ${
        indisponivel ? "opacity-45" : ""
      }`}
    >
      <div className="relative">
        <Imagem produto={produto} indice={indice} altura="h-32" largura="grade" />
        {indisponivel ? (
          <span className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
            Esgotado hoje
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-base leading-tight font-semibold">{produto.name}</p>
        {produto.description ? (
          <p className="text-muted line-clamp-2 text-sm leading-snug">{produto.description}</p>
        ) : null}

        <div className="mt-auto flex items-center justify-between pt-3">
          <span className="text-accent text-lg font-bold">{money(produto.price)}</span>
          <span
            className={`jm-touch flex items-center justify-center rounded-full px-4 text-sm font-semibold ${
              indisponivel ? "bg-line text-muted" : "bg-primary text-white"
            }`}
          >
            {indisponivel ? "Indisponível" : produto.option_groups.length > 0 ? "Escolher" : "Ver"}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Vitrine do topo: foto grande com movimento, nome e preço numa faixa sólida. */
export function FeaturedCard({
  produto,
  indice,
  onAbrir,
}: {
  produto: MenuProduct;
  indice: number;
  onAbrir: (produto: MenuProduct) => void;
}) {
  const indisponivel = !produto.is_available;

  return (
    <button
      type="button"
      onClick={() => onAbrir(produto)}
      disabled={indisponivel}
      className={`jm-focus rounded-card shadow-hero relative w-60 shrink-0 overflow-hidden text-left ${
        indisponivel ? "opacity-45" : ""
      }`}
    >
      <Imagem produto={produto} indice={indice} altura="h-[150px]" largura="vitrine" />
      {/* Faixa sólida, e não véu em gradiente: com gradiente o contraste do texto não é
          mensurável, e o NF-007 exige medir. Branco sobre a cor primária é o par que o
          JM-055 valida no admin. */}
      <div className="bg-primary absolute inset-x-0 bottom-0 p-3">
        <p className="text-sm font-semibold text-white">{produto.name}</p>
        <p className="text-base font-bold text-white">{money(produto.price)}</p>
      </div>
    </button>
  );
}
