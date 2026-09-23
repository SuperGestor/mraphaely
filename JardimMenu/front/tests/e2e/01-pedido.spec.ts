import { expect, test } from "@playwright/test";
import { fecharContextos, abrirConta, abrirMesaNaEquipe, adicionar, entrarNaEquipe, entrarNoAdmin, enviar, parearTablet} from "./apoio";

/**
 * E2E-01, E2E-02 e E2E-04: pedido do tablet até a tela da equipe, segundo pedido da mesma
 * abertura, e produto que fica indisponível no meio da sessão.
 */


test.afterEach(fecharContextos);

test("E2E-01/02: tablet pareado envia, o pedido entra confirmed e aparece na equipe com o código do PDV", async ({ browser }) => {
  const tablet = await parearTablet(browser, 1);
  const equipe = await entrarNaEquipe(browser);

  // Complemento obrigatório: sem o ponto da carne, o botão fica travado.
  await tablet.locator("[data-produto]").filter({ hasText: "Burger do jardim" }).first().getByRole("button").click();
  const modal = tablet.getByRole("dialog", { name: "Burger do jardim" });
  await expect(modal.getByRole("button", { name: /^Adicionar · / })).toBeDisabled();
  await modal.getByRole("radio", { name: "Ao ponto" }).click();
  await modal.getByRole("checkbox", { name: /Bacon artesanal/ }).click();
  await expect(modal.getByRole("button", { name: "Adicionar · R$ 62,00" })).toBeEnabled();
  await modal.getByRole("button", { name: /^Adicionar · / }).click();

  const primeiro = await enviar(tablet);
  expect(primeiro).toBeGreaterThan(0);

  // Sem toque da equipe: a tela da equipe mostra o pedido, com o código do PDV de cada item.
  const recente = equipe.locator("article").filter({ hasText: `Pedido nº ${primeiro}` }).first();
  await expect(recente).toBeVisible({ timeout: 5_000 });
  await expect(recente).toContainText("PDV-1301");
  await expect(recente).toContainText("Bacon artesanal (PDV-B1)");

  // E2E-02: o segundo pedido da mesma abertura entra direto.
  await adicionar(tablet, "Chopp Pilsen da casa");
  const segundo = await enviar(tablet);
  expect(segundo).toBe(primeiro + 1);

  const conta = await abrirConta(tablet);
  await expect(conta).toContainText(`Pedido nº ${primeiro}`);
  await expect(conta).toContainText(`Pedido nº ${segundo}`);
  await expect(conta).toContainText("R$ 78,00");
  await expect(conta).toContainText("Valor final confirmado no caixa.");

  const detalhe = await abrirMesaNaEquipe(equipe, 1);
  await expect(detalhe).toContainText("R$ 78,00");
});

test("E2E-04: produto indisponível no meio da sessão fica esmaecido em até 10 s e o envio com ele é recusado", async ({ browser }) => {
  const tablet = await parearTablet(browser, 2);
  await adicionar(tablet, "Pão de fermentação natural");

  // O gestor marca o produto indisponível pelo admin (JM-004).
  const admin = await entrarNoAdmin(browser, "/admin/cardapio");
  await admin.getByRole("switch", { name: "Disponibilidade de Pão de fermentação natural" }).click();

  try {
    const card = tablet.locator("[data-produto]").filter({ hasText: "Pão de fermentação natural" }).first();
    await expect(card).toContainText("Indisponível", { timeout: 12_000 });

    await tablet.getByRole("button", { name: "Ver pedido" }).click();
    await tablet.getByRole("button", { name: "Finalizar pedido" }).click();
    await tablet.getByRole("button", { name: "Confirmar pedido" }).click();
    // Dentro da revisão: o Next também tem um role="alert" (o anunciador de rota).
    const revisao = tablet.getByRole("dialog", { name: "Confere seu pedido?" });
    await expect(revisao.getByRole("alert")).toContainText("Produto indisponível agora: Pão de fermentação natural.");
  } finally {
    await admin.getByRole("switch", { name: "Disponibilidade de Pão de fermentação natural" }).click();
  }
});
