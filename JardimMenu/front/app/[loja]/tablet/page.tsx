import type { Metadata, Viewport } from "next";
import { MenuScreen } from "@/components/tablet/MenuScreen";
import { ErroDoTablet } from "@/components/tablet/ErroDoTablet";

/**
 * Rota do cliente, no tablet em modo kiosk (JM-181).
 *
 * Com banco, a mesa é resolvida pelo `device_token` guardado no aparelho, e o parâmetro
 * `?mesa=` é ignorado: nenhuma tela do cliente escolhe a própria mesa. O parâmetro só vale
 * no cardápio de exemplo, para a rodada de layout. A tela inteira fica dentro da barreira
 * de erro (JM-184), que mostra a mesa e o garçom em vez de tela branca.
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
  params,
  searchParams,
}: {
  params: Promise<{ loja: string }>;
  searchParams: Promise<{ mesa?: string }>;
}) {
  const { loja } = await params;
  const { mesa } = await searchParams;
  const numero = mesa && /^\d+$/.test(mesa) ? Number(mesa) : 7;

  return (
    <ErroDoTablet>
      <MenuScreen loja={loja} mesa={numero} />
    </ErroDoTablet>
  );
}
