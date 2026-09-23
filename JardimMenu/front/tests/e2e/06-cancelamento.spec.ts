import { expect, test } from "@playwright/test";
import { fecharContextos, abrirConta, adicionar, entrarNaEquipe, enviar, parearTablet} from "./apoio";

/**
 * E2E-27 (JM-111): o cliente pede o cancelamento no tablet, o garçom vê em 2 s e recusa, e
 * o tablet é avisado; pede de novo, o garçom aprova, e o item sai da conta em até 10 s; dois
 * toques não criam dois pedidos.
 *
 * O cenário monta o próprio pedido, numa mesa que nenhum outro usa, para não depender da
 * ordem dos arquivos.
 */

test.afterEach(fecharContextos);

test("E2E-27: pedido de cancelamento recusado, pedido de novo e aprovado", async ({ browser }) => {
  const tablet = await parearTablet(browser, 7);
  const equipe = await entrarNaEquipe(browser);

  await adicionar(tablet, "Chopp Pilsen da casa");
  await adicionar(tablet, "Bolinho de mandioca");
  await enviar(tablet);

  const conta = await abrirConta(tablet);
  await expect(conta).toContainText("R$ 48,00");
  // O texto do item aparece no <li> do item e no <li> do pedido inteiro: vale o mais interno.
  const linhaDoChopp = conta.locator("li").filter({ hasText: "1× Chopp Pilsen da casa" }).last();
  await linhaDoChopp.getByRole("button", { name: "Pedir cancelamento deste item" }).click();
  await conta.getByRole("alertdialog").getByRole("button", { name: "Pedir cancelamento" }).click();
  await expect(linhaDoChopp).toContainText("Cancelamento pedido, aguardando a equipe.");

  // Dois toques não criam dois pedidos: o mesmo pedido de novo, pela rota, não cria outro.
  const token = await tablet.evaluate(() => localStorage.getItem("jm.dt") ?? "");
  const resumo = await (await tablet.request.get("/api/tablet/resumo", { headers: { "x-device-token": token } })).json();
  const pendente = resumo.cancel_requests.find((c: { status: string }) => c.status === "pending");
  expect(pendente).toBeTruthy();
  const repetido = await tablet.request.post("/api/tablet/cancelamento", {
    headers: { "x-device-token": token, "content-type": "application/json" },
    data: { order_id: pendente.order_id, item_id: pendente.item_id },
  });
  expect(repetido.ok()).toBe(true);

  const pedido = equipe.getByRole("listitem").filter({ hasText: "Mesa 7 pede cancelamento" });
  await expect(pedido).toHaveCount(1, { timeout: 2_000 });
  await expect(pedido).toContainText("1× Chopp Pilsen da casa");
  await pedido.getByRole("button", { name: "Recusar" }).click();
  await expect(pedido).toHaveCount(0);

  // O tablet é avisado no polling (até 10 s).
  await expect(linhaDoChopp).toContainText("A equipe não aprovou o cancelamento.", { timeout: 11_000 });

  // Pede de novo; desta vez o garçom aprova, e o item sai da conta em até 10 s.
  await linhaDoChopp.getByRole("button", { name: "Pedir cancelamento deste item" }).click();
  await conta.getByRole("alertdialog").getByRole("button", { name: "Pedir cancelamento" }).click();
  await expect(pedido).toHaveCount(1, { timeout: 2_000 });
  await pedido.getByRole("button", { name: "Aprovar" }).click();

  await expect(linhaDoChopp).toHaveCount(0, { timeout: 11_000 });
  await expect(conta).toContainText("A equipe aprovou um cancelamento");
  await expect(conta).toContainText("R$ 32,00");
});
