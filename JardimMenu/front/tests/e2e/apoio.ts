import { expect, type Browser, type Page } from "@playwright/test";

/**
 * Apoio dos E2E: parear um tablet pela tela de configuração (com o login do gestor, sem QR,
 * decisão de 21/09/2026), entrar na tela da equipe e montar pedidos pela tela do cliente.
 * Tudo pela interface: nenhum atalho de banco, para o teste passar pelas mesmas rotas que
 * o tablet e a equipe usam.
 */

export const LOJA = "jardim-secreto";
export const SENHA = "jardim-local-123";
export const GESTOR = "gestor@jardim.local";
export const GARCOM = "garcom@jardim.local";
export const DONO = "dono@jardim.local";

export async function parearTablet(browser: Browser, mesa: number): Promise<Page> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await page.goto(`/${LOJA}/tablet/setup`);
  await page.getByLabel("E-mail da equipe").fill(GESTOR);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByLabel("Número da mesa deste tablet").fill(String(mesa));
  await page.getByRole("button", { name: "Parear este tablet" }).click();
  await page.getByRole("link", { name: "Abrir o cardápio" }).click();
  await expect(page).toHaveURL(new RegExp(`/${LOJA}/tablet`));
  await expect(page.getByText(`Mesa ${mesa}`).first()).toBeVisible();
  return page;
}

export async function entrarNaEquipe(browser: Browser, email = GARCOM): Promise<Page> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await page.goto("/login?de=/equipe");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/equipe/);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  return page;
}

/** Entra no admin como o gestor, já no caminho pedido. */
export async function entrarNoAdmin(browser: Browser, caminho: string, email = GESTOR): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/login?de=${encodeURIComponent(caminho)}`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(new RegExp(caminho));
  return page;
}

/** Abre o produto pelo card, marca os complementos pelo nome e adiciona à sacola. */
export async function adicionar(page: Page, produto: string, opcoes: string[] = []) {
  await page.locator("[data-produto]").filter({ hasText: produto }).first().getByRole("button").click();
  const modal = page.getByRole("dialog", { name: produto });
  for (const opcao of opcoes) {
    await modal.getByRole("radio", { name: opcao }).or(modal.getByRole("checkbox", { name: opcao })).first().click();
  }
  await modal.getByRole("button", { name: /^(Adicionar|Salvar alterações) · / }).click();
  await expect(modal).toBeHidden();
}

/** Da sacola ao "Pedido nº N enviado". Devolve N. */
export async function enviar(page: Page): Promise<number> {
  await page.getByRole("button", { name: "Ver pedido" }).click();
  await page.getByRole("button", { name: "Finalizar pedido" }).click();
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  const titulo = page.getByRole("heading", { name: /Pedido nº \d+ enviado/ });
  await expect(titulo).toBeVisible();
  const numero = Number((await titulo.textContent())?.match(/\d+/)?.[0]);
  await page.getByRole("button", { name: "Voltar ao cardápio" }).click();
  return numero;
}

export async function abrirConta(page: Page) {
  await page.getByRole("button", { name: /Conta da mesa|Minha comanda e conta da mesa/ }).click();
  return page.getByRole("dialog", { name: /Conta da mesa|Minha comanda/ });
}

/** O cartão da mesa na tela da equipe, e o detalhe dela. */
export async function abrirMesaNaEquipe(equipe: Page, mesa: number) {
  await equipe.getByRole("button", { name: new RegExp(`^${mesa}\\b`) }).first().click();
  const detalhe = equipe.getByRole("dialog", { name: new RegExp(`Mesa ${mesa}`) });
  await expect(detalhe).toBeVisible();
  return detalhe;
}
