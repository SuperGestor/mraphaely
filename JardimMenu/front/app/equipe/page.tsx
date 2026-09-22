import type { Metadata } from "next";
import { TelaDaEquipe } from "@/components/equipe/TelaDaEquipe";

/**
 * Tela da equipe (JM-121, D23, D30): chamados, pedidos de cancelamento, mesas com as
 * comandas e os pedidos com o código do PDV, e as ações do salão. O login é exigido pelo
 * middleware, e o papel, por cada function do banco.
 */
export const metadata: Metadata = { title: "Salão" };

export default function EquipePage() {
  return <TelaDaEquipe />;
}
