import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Apoio dos E2E: parear um tablet pela tela de configuração (com o login do gestor, sem QR,
 * decisão de 21/09/2026), entrar na tela da equipe e montar pedidos pela tela do cliente.
 * Tudo pela interface: nenhum atalho de banco, para o teste passar pelas mesmas rotas que
 * o tablet e a equipe usam.
 */

/**
 * Cada cenário abre navegadores próprios (tablet, equipe, admin). Sem fechar no fim, as
 * abas de todos os cenários ficam vivas, cada uma com o polling de 10 s e o Realtime, e a
 * disputa por processador faz a tela da equipe passar dos 2 s que o NF-003 pede. Por isso
 * todo spec chama test.afterEach(fecharContextos).
 */
const contextos: BrowserContext[] = [];

async function novaAba(browser: Browser): Promise<Page> {
  const contexto = await browser.newContext();
  contextos.push(contexto);
  return contexto.newPage();
}

/**
 * Fecha tudo entre cenários. Cada fechamento tem prazo: já aconteceu de um `close()` ficar
 * pendurado e segurar a série inteira — um cenário de 90 s de limite apareceu no relatório
 * com 50 min, porque o limite do Playwright vale para o teste, e o gancho de depois ficou
 * esperando sozinho. Estourado o prazo, seguimos em frente: uma aba que não fechou custa
 * memória, e uma série travada custa a rodada.
 */
export async function fecharContextos() {
  const prazo = new Promise((resolve) => setTimeout(resolve, 10_000).unref?.());
  await Promise.all(contextos.splice(0).map((c) => Promise.race([c.close().catch(() => {}), prazo])));
}

export const LOJA = "jardim-secreto";
export const SENHA = "jardim-local-123";
export const GESTOR = "gestor@jardim.local";
export const GARCOM = "garcom@jardim.local";
export const DONO = "dono@jardim.local";

export async function parearTablet(browser: Browser, mesa: number): Promise<Page> {
  const page = await novaAba(browser);
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
  const page = await novaAba(browser);
  await page.goto("/login?de=/equipe");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/equipe/);
  await expect(page.getByRole("heading", { name: "Mesas" })).toBeVisible();
  // Espera o Realtime entrar no canal antes de devolver a tela. Os cenários medem os 2 s do
  // NF-003, e sem isto eles mediriam, junto, quanto o servidor de Realtime levou para
  // aceitar a assinatura — logo depois de um `db reset`, que reinicia os contêineres, isso
  // passa dos 2 s e a tela só atualiza na releitura de segurança de 10 s. O teste falharia
  // por causa do contêiner, e não do produto. Quando o Realtime cai de verdade, quem cobre
  // é o E2E-08.
  await expect(page.getByRole("status").filter({ hasText: "ao vivo" })).toBeVisible({ timeout: 30_000 });
  return page;
}

/** Entra no admin como o gestor, já no caminho pedido. */
export async function entrarNoAdmin(browser: Browser, caminho: string, email = GESTOR): Promise<Page> {
  const page = await novaAba(browser);
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

// ------------------------------------------------------------------ a outra loja (E2E-14)

/** A segunda loja da massa (back/supabase/seed.sql), que só existe para o teste de isolamento. */
export const LOJA_CONFRARIA = "confraria";
export const GESTOR_CONFRARIA = "gestor@confraria.local";

/**
 * O mesmo pareamento do `parearTablet`, pela mesma tela, para qualquer loja e com o login de
 * quem é da equipe dela (JM-180, decisão de 21/09/2026). O `parearTablet` segue sendo o
 * atalho do Jardim Secreto; este existe para o E2E-14, que precisa de um tablet em cada loja.
 *
 * A URL é conferida até o fim (`/tablet` e nada depois): a própria tela de configuração já
 * casaria com o começo, e o "Mesa N" dela passaria pelo "Mesa N" do cardápio. Com o `$`,
 * quando o helper devolve a página, o cardápio da loja do token já é o que está na tela.
 */
export async function parearTabletDaLoja(browser: Browser, loja: string, email: string, mesa: number): Promise<Page> {
  const page = await novaAba(browser);
  await page.goto(`/${loja}/tablet/setup`);
  await page.getByLabel("E-mail da equipe").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByLabel("Número da mesa deste tablet").fill(String(mesa));
  await page.getByRole("button", { name: "Parear este tablet" }).click();
  await page.getByRole("link", { name: "Abrir o cardápio" }).click();
  await expect(page).toHaveURL(new RegExp(`/${loja}/tablet$`));
  await expect(page.getByText(`Mesa ${mesa}`).first()).toBeVisible();
  return page;
}

/**
 * O token que o tablet guardou no pareamento (`CHAVE_DO_TOKEN` de lib/tablet-source.ts). Ele
 * vive só no armazenamento local do aparelho e nunca aparece em URL, log ou outra resposta
 * (NF-006); é por ele que o teste chama as rotas do tablet sem passar pela tela.
 */
export function tokenDoTablet(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem("jm.dt") ?? "");
}
