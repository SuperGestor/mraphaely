/**
 * URL pública da foto de produto no Storage (JM-002, §18.4).
 *
 * O upload grava três larguras em WebP sob o mesmo prefixo (`photo_path`): grade 400 px,
 * vitrine 600 px e modal 900 px. Cada tela pede a menor que serve, que é o que mantém o
 * NF-001 alcançável no tablet.
 */
export type LarguraDaFoto = "grade" | "vitrine" | "modal";

export function urlDaFoto(photoPath: string | null, largura: LarguraDaFoto): string | null {
  if (!photoPath) return null;
  // Cardápio de exemplo: arquivo estático em public/mock, gerado por
  // scripts/gerar-fotos-mock.mjs. Caminho do Storage nunca começa com "/", porque a
  // function do banco exige a pasta da loja no início.
  if (photoPath.startsWith("/")) return `${photoPath}/${largura}.webp`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/produtos/${photoPath}/${largura}.webp`;
}
