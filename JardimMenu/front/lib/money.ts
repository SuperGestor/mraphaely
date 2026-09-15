/** Dinheiro é `numeric(10,2)` no banco e `Intl.NumberFormat` na tela (CLAUDE.md). */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function money(valor: number): string {
  return brl.format(valor);
}

/** "+ R$ 6,00" para delta de complemento. Delta zero não mostra nada. */
export function moneyDelta(valor: number): string | null {
  if (valor === 0) return null;
  return `+ ${brl.format(valor)}`;
}
