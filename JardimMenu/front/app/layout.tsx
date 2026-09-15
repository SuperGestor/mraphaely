import type { Metadata } from "next";
import "./globals.css";
import { brand } from "@/lib/brand";

/**
 * Sem `next/font`: o kiosk roda no Wi-Fi do salão, e fonte baixada de fora é peso e
 * dependência de rede que a tela do cliente não precisa ter (NF-001, NF-004).
 * A pilha de fontes do sistema está no globals.css.
 */
export const metadata: Metadata = {
  title: { default: brand.productName, template: `%s · ${brand.productName}` },
  description: "Cardápio digital do salão, no tablet da casa.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
