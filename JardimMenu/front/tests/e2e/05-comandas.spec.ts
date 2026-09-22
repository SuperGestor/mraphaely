import { expect, test, type Page } from "@playwright/test";
import { abrirConta, abrirMesaNaEquipe, adicionar, entrarNaEquipe, entrarNoAdmin, GESTOR, parearTablet } from "./apoio";

/**
 * Módulo N na Fase B: E2E-23 (JM-200, JM-201, JM-203), E2E-26 (JM-209) e E2E-25 (JM-208,
 * JM-141). Em série: a loja passa ao modo nomeada no começo e volta no fim.
 *
 * Fora daqui, por serem da Fase C (divergência registrada no plano do prompt 3): mover
 * item entre comandas (JM-205) e encerrar comanda sem consumo em 1 toque pelo tablet
 * (JM-207), que o texto do E2E-23 inclui.
 */
test.describe.configure({ mode: "serial" });

async function modoDaLoja(browser: Parameters<typeof entrarNoAdmin>[0], modo: "Uma conta por mesa" | "Comanda com nome") {
  const admin = await entrarNoAdmin(browser, "/admin/mesas");
  await admin.getByRole("radio", { name: new RegExp(modo) }).click();
  await expect(admin.getByRole("radio", { name: new RegExp(modo) })).toHaveAttribute("aria-checked", "true");
  await admin.context().close();
}

/** Da sacola à revisão, escolhendo (ou criando) a comanda pelo seletor. */
async function enviarNaComanda(tablet: Page, nome: string, criar: boolean) {
  await tablet.getByRole("button", { name: "Ver pedido" }).click();
  await tablet.getByRole("button", { name: "Finalizar pedido" }).click();
  const seletor = tablet.getByRole("dialog", { name: "De quem é este pedido?" });
  if (await seletor.isVisible()) {
    if (criar) {
      await seletor.getByPlaceholder("Seu nome ou apelido").fill(nome);
      await seletor.getByRole("button", { name: "Abrir comanda" }).click();
    } else {
      await seletor.getByRole("button", { name: nome, exact: true }).click();
    }
  }
  const revisao = tablet.getByRole("dialog", { name: "Confere seu pedido?" });
  await expect(revisao).toContainText(`Pedindo como: ${nome}`);
  await revisao.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(tablet.getByText(`comanda de ${nome}`)).toBeVisible();
  await tablet.getByRole("button", { name: "Voltar ao cardápio" }).click();
}

test.beforeAll(async ({ browser }) => {
  await modoDaLoja(browser, "Comanda com nome");
});

test.afterAll(async ({ browser }) => {
  await modoDaLoja(browser, "Uma conta por mesa");
});

test("E2E-23: no modo nomeada, o primeiro pedido exige comanda, nome repetido é recusado e cada conta soma a sua", async ({ browser }) => {
  const tablet = await parearTablet(browser, 9);
  await expect(tablet.getByText("Nenhuma comanda escolhida")).toBeVisible();

  await adicionar(tablet, "Chopp Pilsen da casa");
  await enviarNaComanda(tablet, "Ana", true);

  // A limpeza depois do envio zera a comanda ativa (JM-201): a próxima pessoa escolhe a sua.
  await expect(tablet.getByText("Nenhuma comanda escolhida")).toBeVisible();

  await adicionar(tablet, "Bolinho de mandioca");
  await tablet.getByRole("button", { name: "Ver pedido" }).click();
  await tablet.getByRole("button", { name: "Finalizar pedido" }).click();
  const seletor = tablet.getByRole("dialog", { name: "De quem é este pedido?" });
  await expect(seletor.getByRole("button", { name: "Ana", exact: true })).toBeVisible();
  await seletor.getByPlaceholder("Seu nome ou apelido").fill("ana");
  await seletor.getByRole("button", { name: "Abrir comanda" }).click();
  await expect(seletor.getByRole("alert")).toContainText("Já existe uma comanda aberta com esse nome");
  await seletor.getByPlaceholder("Seu nome ou apelido").fill("Bruno");
  await seletor.getByRole("button", { name: "Abrir comanda" }).click();
  const revisao = tablet.getByRole("dialog", { name: "Confere seu pedido?" });
  await expect(revisao).toContainText("Pedindo como: Bruno");
  await revisao.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(tablet.getByText("comanda de Bruno")).toBeVisible();
  await tablet.getByRole("button", { name: "Voltar ao cardápio" }).click();

  // Depois do envio, a limpeza zera a comanda ativa (JM-201): "Minha comanda" fica vazia até
  // a próxima pessoa escolher a sua. A "Conta da mesa" soma as duas comandas (JM-203).
  const conta = await abrirConta(tablet);
  await expect(conta).toContainText("Nenhuma comanda escolhida.");
  await conta.getByRole("tab", { name: "Conta da mesa" }).click();
  await expect(conta).toContainText("Ana");
  await expect(conta).toContainText("Bruno");
  await expect(conta).toContainText("R$ 48,00");

  // Escolhida de novo a comanda do Bruno, "Minha comanda" mostra só o que é dele.
  await conta.getByRole("tab", { name: "Minha comanda" }).click();
  await conta.getByRole("button", { name: "Escolher comanda" }).click();
  await tablet.getByRole("dialog", { name: "Trocar de comanda" }).getByRole("button", { name: "Bruno", exact: true }).click();
  await expect(conta).toContainText("1× Bolinho de mandioca");
  await expect(conta).toContainText("R$ 32,00");
  await expect(conta).not.toContainText("Chopp Pilsen da casa");
});

test("E2E-26: comanda migra para mesa livre, nome repetido no destino é recusado, encerrada não migra, e a origem fecha", async ({ browser }) => {
  const equipe = await entrarNaEquipe(browser);

  // Ana (mesa 9) vai para a mesa 10, livre: a 10 abre, e a 9 segue com o Bruno.
  let detalhe = await abrirMesaNaEquipe(equipe, 9);
  await detalhe.locator("section").filter({ hasText: /^Ana/ }).getByRole("button", { name: "Migrar de mesa" }).click();
  let dialogo = equipe.getByRole("dialog", { name: /Migrar a comanda Ana/ });
  await dialogo.getByRole("radio", { name: /^10/ }).click();
  await dialogo.getByRole("button", { name: "Migrar" }).click();
  await expect(detalhe).not.toContainText("Ana");
  await expect(detalhe).toContainText("Bruno");
  await detalhe.getByRole("button", { name: "Fechar a mesa na tela" }).click();
  await expect(equipe.getByRole("button", { name: /^10\b/ })).toContainText("R$ 16,00");

  // Nova Ana na mesa 9, pelo tablet; migrar para a 10, onde já há uma Ana, é recusado.
  const tablet = await parearTablet(browser, 9);
  await adicionar(tablet, "Chopp Pilsen da casa");
  await enviarNaComanda(tablet, "Ana", true);
  detalhe = await abrirMesaNaEquipe(equipe, 9);
  await detalhe.locator("section").filter({ hasText: /^Ana/ }).getByRole("button", { name: "Migrar de mesa" }).click();
  dialogo = equipe.getByRole("dialog", { name: /Migrar a comanda Ana/ });
  await dialogo.getByRole("radio", { name: /^10/ }).click();
  await dialogo.getByRole("button", { name: "Migrar" }).click();
  await expect(dialogo.getByRole("alert")).toContainText("Já existe uma comanda aberta com esse nome");
  await dialogo.getByRole("button", { name: "Voltar" }).click();

  // Encerrada, a comanda não migra (JMT02): pela rota, com o id guardado antes.
  const antes = await (await equipe.request.get(`/api/equipe/salao?loja=30000000-0000-4000-8000-000000000001`)).json();
  const mesa9 = antes.tables.find((m: { number: number }) => m.number === 9);
  const idDaAna = mesa9.session.tabs.find((t: { name: string }) => t.name === "Ana").id;
  await detalhe.locator("section").filter({ hasText: /^Ana/ }).getByRole("button", { name: "Encerrar comanda" }).click();
  await equipe.getByRole("dialog", { name: /Encerrar a comanda Ana/ }).getByRole("button", { name: "Encerrar" }).click();
  // A comanda só está encerrada quando sai da tela; antes disso, migrar seria recusado por
  // nome repetido (JMT04), e não por comanda encerrada (JMT02).
  await expect(detalhe.locator("section").filter({ hasText: /^Ana/ })).toHaveCount(0);
  const mesa10 = antes.tables.find((m: { number: number }) => m.number === 10);
  const encerrada = await equipe.request.post("/api/equipe/migrar_comanda", { data: { tab_id: idDaAna, mesa_id: mesa10.id } });
  expect(encerrada.status()).toBe(409);
  expect((await encerrada.json()).codigo).toBe("JMT02");

  // O Bruno, última comanda da 9, vai para a 10: a mesa 9 fecha sozinha.
  await detalhe.locator("section").filter({ hasText: /^Bruno/ }).getByRole("button", { name: "Migrar de mesa" }).click();
  dialogo = equipe.getByRole("dialog", { name: /Migrar a comanda Bruno/ });
  await dialogo.getByRole("radio", { name: /^10/ }).click();
  await dialogo.getByRole("button", { name: "Migrar" }).click();
  await expect(equipe.getByRole("status").filter({ hasText: "A mesa ficou livre." })).toBeVisible();
  await expect(equipe.getByRole("button", { name: /^9\b/ })).toContainText("livre");
  // A conta acompanha a comanda: 16 (Ana) + 32 (Bruno) na mesa 10.
  await expect(equipe.getByRole("button", { name: /^10\b/ })).toContainText("R$ 48,00");
});

test("E2E-25: a equipe encerra uma comanda e a outra segue pedindo; a última fecha a mesa, e o gerente fecha outra com motivo", async ({ browser }) => {
  const tablet = await parearTablet(browser, 10);
  const equipe = await entrarNaEquipe(browser, GESTOR);

  let detalhe = await abrirMesaNaEquipe(equipe, 10);
  await detalhe.locator("section").filter({ hasText: /^Ana/ }).getByRole("button", { name: "Encerrar comanda" }).click();
  await equipe.getByRole("dialog", { name: /Encerrar a comanda Ana/ }).getByRole("button", { name: "Encerrar" }).click();
  await expect(detalhe).not.toContainText("Ana");

  // O Bruno segue pedindo na mesa 10.
  await adicionar(tablet, "Chopp Pilsen da casa");
  await enviarNaComanda(tablet, "Bruno", false);

  // Encerrado o Bruno, a abertura fecha sozinha; o toque seguinte abre outra, sem herança.
  await detalhe.locator("section").filter({ hasText: /^Bruno/ }).getByRole("button", { name: "Encerrar comanda" }).click();
  await equipe.getByRole("dialog", { name: /Encerrar a comanda Bruno/ }).getByRole("button", { name: "Encerrar" }).click();
  await expect(equipe.getByRole("status").filter({ hasText: "A mesa ficou livre." })).toBeVisible();
  await tablet.locator("[data-produto]").first().getByRole("button").click();
  await tablet.keyboard.press("Escape");
  const conta = await abrirConta(tablet);
  await expect(conta).toContainText("Nenhuma comanda escolhida");
  await conta.getByRole("tab", { name: "Conta da mesa" }).click();
  await expect(conta).toContainText("Nenhuma comanda aberta");

  // Outra mesa com comanda aberta (a 2, aberta no E2E-04) é fechada pelo gerente, com motivo.
  detalhe = await abrirMesaNaEquipe(equipe, 2);
  await detalhe.getByRole("button", { name: "Fechar a mesa com motivo" }).click();
  const fechar = equipe.getByRole("dialog", { name: "Fechar a mesa 2?" });
  await fechar.getByLabel("Motivo").fill("Cliente foi embora");
  await fechar.getByRole("button", { name: "Fechar a mesa" }).click();
  await expect(equipe.getByRole("button", { name: /^2\b/ })).toContainText("livre");
});
