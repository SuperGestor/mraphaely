import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { abrirMesaNaEquipe, entrarNaEquipe, entrarNoAdmin, LOJA, parearTablet } from "./apoio";

/**
 * E2E-05 (JM-032), E2E-20 (JM-180, JM-182) e E2E-22 (JM-100, dispositivo). Pela API, com o
 * token que o tablet guardou no pareamento: é o mesmo caminho da tela, sem a interface.
 */

const CHOPP = "50000000-0000-4000-8000-000000000005";

const token = (tablet: Page) => tablet.evaluate(() => localStorage.getItem("jm.dt") ?? "");

async function abrir(request: APIRequestContext, t: string) {
  const r = await request.post("/api/tablet/abrir", { headers: { "x-device-token": t } });
  expect(r.status()).toBe(200);
  return (await r.json()) as { session_id: string; tabs: { id: string }[] };
}

function pedir(request: APIRequestContext, t: string, chave: string, sessao: string, comanda: string) {
  return request.post("/api/orders", {
    headers: { "x-device-token": t, "idempotency-key": chave, "content-type": "application/json" },
    data: { session_id: sessao, tab_id: comanda, items: [{ product_id: CHOPP, quantity: 1, option_ids: [], notes: null }] },
  });
}

test("E2E-05: a mesma chave 3x dá 1 pedido; em outra abertura, é outro pedido e nunca o alheio", async ({ browser, request }) => {
  const tablet = await parearTablet(browser, 3);
  const t = await token(tablet);
  const s1 = await abrir(request, t);
  const chave = `e2e05-${Date.now()}-chave`;

  const respostas = [];
  for (let i = 0; i < 3; i++) respostas.push(await (await pedir(request, t, chave, s1.session_id, s1.tabs[0].id)).json());
  expect(new Set(respostas.map((r) => r.order_id)).size).toBe(1);
  expect(respostas.map((r) => r.replayed)).toEqual([false, true, true]);

  // Sem o header, a rota recusa antes do banco.
  const semChave = await request.post("/api/orders", {
    headers: { "x-device-token": t, "content-type": "application/json" },
    data: { session_id: s1.session_id, tab_id: s1.tabs[0].id, items: [{ product_id: CHOPP, quantity: 1, option_ids: [], notes: null }] },
  });
  expect(semChave.status()).toBe(428);

  // A equipe encerra a conta; a mesa gira, e a mesma chave na abertura nova é outro pedido
  // (JM-032, T5: o documento em §9.4 ainda fala em conflito; vale o JM-032).
  const equipe = await entrarNaEquipe(browser);
  const detalhe = await abrirMesaNaEquipe(equipe, 3);
  await detalhe.getByRole("button", { name: "Encerrar conta" }).click();
  await equipe.getByRole("dialog", { name: /Encerrar a conta/ }).getByRole("button", { name: "Encerrar" }).click();

  const s2 = await abrir(request, t);
  expect(s2.session_id).not.toBe(s1.session_id);
  const outro = await (await pedir(request, t, chave, s2.session_id, s2.tabs[0].id)).json();
  expect(outro.order_id).not.toBe(respostas[0].order_id);
  expect(outro.replayed).toBe(false);
});

test("E2E-20/22: token sobrevive a reinício; reparear aposenta o anterior; inválido, desativado e de outra mesa são recusados", async ({ browser, request }) => {
  const tablet = await parearTablet(browser, 6);
  const antigo = await token(tablet);

  // O token sobrevive a reinício: recarregar a tela mantém a mesa.
  await tablet.reload();
  await expect(tablet.getByText("Mesa 6").first()).toBeVisible();
  const s = await abrir(request, antigo);

  // Token inválido.
  const invalido = await request.post("/api/tablet/abrir", { headers: { "x-device-token": "A".repeat(43) } });
  expect(invalido.status()).toBe(401);
  expect((await invalido.json()).codigo).toBe("JM401");

  // Token de outra mesa: a abertura da mesa 6 não aceita pedido de um tablet da mesa 7.
  const outraMesa = await parearTablet(browser, 7);
  const t7 = await token(outraMesa);
  const deOutra = await pedir(request, t7, `e2e22-${Date.now()}-outra`, s.session_id, s.tabs[0].id);
  expect(deOutra.status()).toBe(403);
  expect((await deOutra.json()).codigo).toBe("JMS03");

  // Desativado (JM423): o pedido é recusado, e o chamado de garçom segue funcionando (JM-187).
  const admin = await entrarNoAdmin(browser, "/admin/dispositivos");
  const linha = admin.getByRole("row").filter({ has: admin.getByRole("cell", { name: "7", exact: true }) });
  await linha.getByRole("button", { name: "Desativar" }).click();
  await expect(linha.getByRole("button", { name: "Reativar" })).toBeVisible();
  try {
    const desativado = await request.post("/api/tablet/abrir", { headers: { "x-device-token": t7 } });
    expect(desativado.status()).toBe(423);
    expect((await desativado.json()).codigo).toBe("JM423");
    const chamado = await request.post("/api/tablet/garcom", { headers: { "x-device-token": t7 } });
    expect(chamado.status()).toBe(200);
  } finally {
    await linha.getByRole("button", { name: "Reativar" }).click();
  }

  // Reparear a mesa 6 aposenta o token anterior (JM-180), que passa a ser recusado.
  await parearTablet(browser, 6);
  const aposentado = await request.post("/api/tablet/abrir", { headers: { "x-device-token": antigo } });
  expect(aposentado.status()).toBe(410);
  expect((await aposentado.json()).codigo).toBe("JM410");

  // A tela do tablet aposentado manda chamar a equipe, com a mesa em destaque (JM-181).
  await tablet.reload();
  await expect(tablet.getByText("Chame a equipe")).toBeVisible();
  await expect(tablet.getByText("Mesa 6").first()).toBeVisible();
  await expect(tablet.getByRole("button", { name: "Chamar garçom" })).toBeVisible();
  await expect(tablet.getByRole("link", { name: "Parear este tablet" })).toHaveAttribute("href", `/${LOJA}/tablet/setup`);
});
