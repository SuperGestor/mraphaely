/**
 * Único lugar com a marca do produto. A A1 (marca, nome e domínio) está em aberto, e
 * enquanto estiver, o valor daqui é provisório.
 *
 * Regra: nenhum componente escreve o nome do produto direto. Trocar a marca é trocar
 * este arquivo, e o domínio vem de variável de ambiente por ambiente.
 *
 * Atenção de calendário: o `device_token` do tablet fica no armazenamento local, que é
 * por origem, e o QR de configuração carrega a URL. Trocar o domínio depois de
 * provisionar obriga a reprovisionar todos os tablets (§14, A1).
 */
export const brand = {
  /** Provisório até a A1. */
  productName: "Jardim Menu",
  shortName: "Jardim Menu",
  /** Razão social do operador da plataforma, para a página de privacidade. */
  operatorLegalName: "[definir na A1]",
  supportEmail: "[definir na A1]",
  /** Origem pública do ambiente. Nunca escrita no código. */
  origin: process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000",
  /** Versão do texto de privacidade, registrada junto do consentimento (NF-008). */
  privacyTextVersion: "2026-09-11",
} as const;
