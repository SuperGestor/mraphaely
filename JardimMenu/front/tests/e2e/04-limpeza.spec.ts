import { expect, test } from "@playwright/test";
import { abrirConta, adicionar, enviar, parearTablet } from "./apoio";

/**
 * E2E-21 (JM-183): a limpeza entre clientes zera sacola, busca e a sessão do pixel, e não
 * encerra a abertura da mesa nem a conta. E, no modo mesa_unica, o cliente nunca vê a
 * palavra comanda (E2E-23, JM-200).
 */
test("E2E-21: novo cliente zera a tela e o pixel, e a conta da mesa continua", async ({ browser }) => {
  const tablet = await parearTablet(browser, 8);
  const sessoesDoPixel: string[] = [];
  tablet.on("request", (r) => {
    if (r.url().endsWith("/api/track") && r.method() === "POST") {
      const corpo = r.postDataJSON() as { session_id?: string } | null;
      if (corpo?.session_id) sessoesDoPixel.push(corpo.session_id);
    }
  });

  await adicionar(tablet, "Bolinho de mandioca");
  await enviar(tablet); // "Voltar ao cardápio" é a limpeza de 15 s adiantada

  await tablet.getByLabel("Buscar no cardápio").fill("chopp");
  await adicionar(tablet, "Chopp Pilsen da casa");
  await expect(tablet.getByRole("button", { name: /Sacola, 1 item/ })).toBeVisible();

  // Nenhuma palavra "comanda" no modo mesa_unica, em nenhuma superfície.
  for (const texto of [await tablet.locator("body").innerText()]) expect(texto).not.toMatch(/comanda/i);

  await tablet.getByRole("button", { name: "Novo cliente" }).click();
  await tablet.getByRole("button", { name: "Esvaziar e começar" }).click();

  await expect(tablet.getByRole("button", { name: "Sacola vazia" })).toBeVisible();
  await expect(tablet.getByLabel("Buscar no cardápio")).toHaveValue("");

  // A conta segue: a limpeza não fecha a mesa.
  const conta = await abrirConta(tablet);
  await expect(conta).toContainText("1× Bolinho de mandioca");
  await expect(conta).toContainText("R$ 32,00");
  expect(await conta.innerText()).not.toMatch(/comanda/i);

  // O pixel ganha sessão nova depois da limpeza (JM-063). O lote sai a cada 8 s.
  await tablet.getByRole("button", { name: "Fechar a conta" }).click();
  await tablet.locator("[data-produto]").first().getByRole("button").click();
  await expect.poll(() => new Set(sessoesDoPixel).size, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
});
