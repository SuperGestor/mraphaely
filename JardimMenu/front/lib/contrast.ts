/**
 * Contraste WCAG para o JM-055: o admin mede a cor primária contra o texto que fica
 * sobre ela **e** a cor de destaque contra o fundo da tela, exigindo 4,5:1 nos dois, e
 * recusa a cor com a sugestão do tom mais próximo que passa.
 *
 * Isto é validação de formulário, e não cálculo de regra de negócio: pode viver no
 * front. O que nunca vive aqui é fuso, turno e preço (regras 5 e 6 do CLAUDE.md).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb | null {
  const limpo = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(limpo)) return null;
  return {
    r: parseInt(limpo.slice(0, 2), 16),
    g: parseInt(limpo.slice(2, 4), 16),
    b: parseInt(limpo.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const p = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

function canal(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminancia(cor: Rgb): number {
  return 0.2126 * canal(cor.r) + 0.7152 * canal(cor.g) + 0.0722 * canal(cor.b);
}

/** Razão de contraste entre duas cores, de 1:1 a 21:1. */
export function contraste(a: Rgb, b: Rgb): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const claro = Math.max(la, lb);
  const escuro = Math.min(la, lb);
  return (claro + 0.05) / (escuro + 0.05);
}

/** Arredonda para uma casa, como o admin mostra. */
export function razao(a: string, b: string): number | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  return Math.round(contraste(ca, cb) * 10) / 10;
}

/**
 * Tom mais próximo da mesma cor que alcança a razão exigida contra `contra`, clareando
 * ou escurecendo em passos pequenos. Devolve null quando nem preto nem branco resolvem.
 */
export function sugerirTom(cor: string, contra: string, minimo = 4.5): string | null {
  const base = parseHex(cor);
  const alvo = parseHex(contra);
  if (!base || !alvo) return null;

  const mistura = (c: Rgb, destino: Rgb, t: number): Rgb => ({
    r: c.r + (destino.r - c.r) * t,
    g: c.g + (destino.g - c.g) * t,
    b: c.b + (destino.b - c.b) * t,
  });

  const preto: Rgb = { r: 0, g: 0, b: 0 };
  const branco: Rgb = { r: 255, g: 255, b: 255 };
  const alvoClaro = luminancia(alvo) > 0.5;
  // Se o outro lado é claro, escurecemos a cor. Se é escuro, clareamos.
  const destino = alvoClaro ? preto : branco;

  for (let t = 0.02; t <= 1; t += 0.02) {
    const candidata = mistura(base, destino, t);
    if (contraste(candidata, alvo) >= minimo) return toHex(candidata);
  }
  return null;
}

export interface ChecagemCor {
  /** A razão medida, arredondada. */
  razao: number;
  passa: boolean;
  /** Tom sugerido quando não passa. */
  sugestao: string | null;
}

export function checar(cor: string, contra: string, minimo = 4.5): ChecagemCor | null {
  const r = razao(cor, contra);
  if (r === null) return null;
  return {
    razao: r,
    passa: r >= minimo,
    sugestao: r >= minimo ? null : sugerirTom(cor, contra, minimo),
  };
}
