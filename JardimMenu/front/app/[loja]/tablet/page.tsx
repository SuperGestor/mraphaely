import type { Metadata, Viewport } from "next";
import { MenuScreen } from "@/components/tablet/MenuScreen";

/**
 * Rota do cliente, no tablet em modo kiosk (JM-181).
 *
 * Na Fase A a mesa ainda vem por parâmetro, para a rodada de layout. Na etapa seguinte
 * ela é resolvida pelo `device_token` guardado no aparelho, e o parâmetro sai: nenhuma
 * tela do cliente escolhe a própria mesa.
 */
export const metadata: Metadata = { title: "Cardápio" };

/**
 * Sem travar o zoom: bloquear ampliação reprova no NF-007, e quem impede gesto de sair
 * do app é o navegador kiosk (NF-018), não a página.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function TabletPage({
  searchParams,
}: {
  params: Promise<{ loja: string }>;
  searchParams: Promise<{ mesa?: string }>;
}) {
  const { mesa } = await searchParams;
  const numero = mesa && /^\d+$/.test(mesa) ? Number(mesa) : 7;

  return <MenuScreen mesa={numero} />;
}
