import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { AdminProvider } from "@/components/admin/AdminContext";
import { AdminShell, type SecaoDoAdmin } from "@/components/admin/AdminShell";

/**
 * Casca do painel de configuração. Uma navegação só, com as seções que a Fase A precisa:
 * cardápio, complementos, mesas, dispositivos, usuários, aparência e horário (JM-050 a
 * JM-052, JM-055, JM-005, JM-180, JM-190).
 *
 * O login é exigido pelo middleware; a loja e o papel vêm do AdminProvider, e cada
 * gravação é conferida de novo pela function do banco.
 *
 * Responsivo desde 15/09/2026: no celular a navegação vira gaveta, e no computador a
 * coluna lateral pode ser minimizada (AdminShell). O admin não usa a classe de kiosk, e
 * permite seleção de texto, porque quem cadastra copia e cola.
 */
export const metadata: Metadata = { title: "Configuração" };

const secoes: SecaoDoAdmin[] = [
  { href: "/admin", rotulo: "Resumo", sigla: "Re" },
  // A tela do turno (JM-121) fica fora do painel, em /equipe; o link é só atalho.
  { href: "/equipe", rotulo: "Salão (equipe)", sigla: "Sa" },
  { href: "/admin/previa", rotulo: "Prévia do cliente", sigla: "Pv" },
  { href: "/admin/cardapio", rotulo: "Cardápio", sigla: "Ca" },
  { href: "/admin/complementos", rotulo: "Complementos", sigla: "Co" },
  { href: "/admin/mesas", rotulo: "Mesas", sigla: "Me" },
  { href: "/admin/dispositivos", rotulo: "Dispositivos", sigla: "Di" },
  { href: "/admin/usuarios", rotulo: "Usuários", sigla: "Us" },
  { href: "/admin/aparencia", rotulo: "Aparência", sigla: "Ap" },
  { href: "/admin/horario", rotulo: "Horário", sigla: "Ho" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminShell produto={brand.productName} secoes={secoes}>
      <AdminProvider>
        <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">{children}</div>
      </AdminProvider>
    </AdminShell>
  );
}
