import Link from "next/link";
import { brand } from "@/lib/brand";

/**
 * Índice de desenvolvimento. Não é tela de produto: no tablet, o kiosk abre direto em
 * `/[loja]/tablet`, e o admin e a tela da equipe entram nas etapas seguintes.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="text-3xl font-bold">{brand.productName}</h1>
      <p className="text-muted mt-2 text-base">
        Etapa A1: cardápio no alvo do tablet, sobre dados de exemplo.
      </p>

      <ul className="mt-8 space-y-3">
        <li>
          <Link
            href="/jardim-secreto/tablet?mesa=7"
            className="text-accent text-lg font-semibold underline"
          >
            Cardápio no tablet, mesa 7
          </Link>
        </li>
        <li>
          <Link href="/privacidade" className="text-accent text-lg font-semibold underline">
            Página de privacidade
          </Link>
        </li>
      </ul>

      <p className="text-muted mt-10 text-sm">
        Marca e domínio são provisórios até a decisão A1, e vivem só em{" "}
        <code>lib/brand.ts</code>.
      </p>
    </main>
  );
}
