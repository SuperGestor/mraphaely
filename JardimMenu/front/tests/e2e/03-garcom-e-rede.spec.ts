import { expect, test } from "@playwright/test";
import { fecharContextos, adicionar, entrarNaEquipe, parearTablet} from "./apoio";

/** E2E-06 (JM-038 a JM-040, JM-187) e E2E-08 (JM-185, JM-035, JM-012). */


test.afterEach(fecharContextos);

test("E2E-06: chamado com rate limit, atendido na equipe em 2 s, e o tablet avisado em até 10 s", async ({ browser }) => {
  const tablet = await parearTablet(browser, 4);
  const equipe = await entrarNaEquipe(browser);

  const botao = tablet.locator("[data-garcom]").first();
  await botao.click();
  await expect(tablet.getByRole("status").filter({ hasText: "Chamado recebido pela equipe" })).toBeVisible();
  await expect(botao).toHaveAttribute("data-garcom", "chamado");

  // Segundo toque dentro de 60 s: o mesmo chamado (JM-038, decidido no banco).
  await botao.click();
  await expect(tablet.getByRole("status").filter({ hasText: "A equipe já recebeu o chamado" })).toBeVisible();

  const cartao = equipe.getByRole("listitem").filter({ hasText: "Mesa 4 chamando" });
  await expect(cartao).toHaveCount(1, { timeout: 2_000 });
  await cartao.getByRole("button", { name: "Atender" }).click();
  await expect(cartao).toHaveCount(0);

  // O tablet não assina Realtime: o polling de 10 s traz o atendimento (JM-039, P7).
  await expect(botao).toHaveAttribute("data-garcom", "a_caminho", { timeout: 11_000 });
});

test("E2E-08: sem rede, nenhum pedido sai, nenhuma confirmação falsa, e o garçom segue visível", async ({ browser }) => {
  const tablet = await parearTablet(browser, 5);
  const equipe = await entrarNaEquipe(browser);
  await adicionar(tablet, "Chopp Pilsen da casa");

  await tablet.context().setOffline(true);
  try {
    const faixa = tablet.getByRole("status").filter({ hasText: "Sem conexão, chame o garçom" });
    await expect(faixa).toBeVisible();
    await expect(faixa).toContainText("Mesa 5");

    await tablet.getByRole("button", { name: "Ver pedido" }).click();
    await tablet.getByRole("button", { name: "Finalizar pedido" }).click();
    const revisao = tablet.getByRole("dialog", { name: "Confere seu pedido?" });
    await expect(revisao.getByRole("button", { name: "Confirmar pedido" })).toBeDisabled();
    await expect(revisao).toContainText("Sem conexão. Nenhum pedido sai sem rede");
    await expect(revisao.locator("[data-garcom]")).toBeVisible();

    // O garçom sem rede manda chamar com a voz, com a mesa em fonte grande (JM-185).
    await revisao.locator("[data-garcom]").click();
    await expect(tablet.getByRole("alert").filter({ hasText: "Mesa 5" })).toBeVisible();
    await expect(tablet.getByRole("heading", { name: /Pedido nº \d+ enviado/ })).toHaveCount(0);
  } finally {
    await tablet.context().setOffline(false);
  }

  // A rede volta e a faixa some sozinha (JM-012); nenhum pedido da mesa 5 chegou.
  await expect(tablet.getByRole("status").filter({ hasText: "Sem conexão, chame o garçom" })).toHaveCount(0, { timeout: 15_000 });
  await equipe.reload();
  await expect(equipe.locator("article").filter({ hasText: "Mesa 5 ·" })).toHaveCount(0);
});
