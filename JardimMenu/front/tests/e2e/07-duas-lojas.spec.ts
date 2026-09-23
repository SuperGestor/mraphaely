import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import type { Menu } from "@/lib/types";
import {
  entrarNoAdmin,
  fecharContextos,
  GESTOR,
  GESTOR_CONFRARIA,
  LOJA,
  LOJA_CONFRARIA,
  parearTabletDaLoja,
  tokenDoTablet,
} from "./apoio";

/**
 * E2E-14 (§9.2): duas lojas com cardápio distinto, sem vazamento de categoria, produto ou
 * preço, e produto indisponível deixa de ser adicionável (JM-001, JM-004, JM-031, JM-100).
 *
 * A outra loja é a Confraria da massa (back/supabase/seed.sql): mesa 1, a categoria "Vinhos"
 * e o produto "Vinho da Confraria", pareada com o login do gestor dela. O que cada tablet
 * pode ver vem da rota do cardápio com o token dele, e a tela é conferida contra isso: os
 * nomes e os preços não ficam escritos aqui, fora o do vinho, que é o caso do teste.
 *
 * Mesa do Jardim: a massa tem as mesas 1 a 10, e os specs 01 a 06 usam todas. Este reusa a 2,
 * que fora daqui só aparece no E2E-04, o cenário que não envia pedido. Do lado do Jardim o
 * spec só lê: não toca na tela (o primeiro toque abriria a abertura da mesa, JM-182), não
 * envia pedido e não chama garçom, então a mesa não ganha abertura, pedido nem chamado. O
 * que muda é o tablet dela: parear de novo aposenta o anterior (JM-180), e todo spec pareia
 * o próprio tablet no começo, então nenhum depende do que ficou para trás.
 *
 * Horário: a Confraria tem horário restrito na massa. O cardápio segue navegável fora dele, e
 * o total do item também não depende do relógio; quem confere o horário da casa é só o envio
 * do pedido (JMH01). Por isso este spec não envia pedido, e passa a qualquer hora e dia.
 */

test.afterEach(fecharContextos);

/** A mesa do Jardim que este spec pareia. Só lê o cardápio: nada é pedido por ela. */
const MESA_DO_JARDIM = 2;
const MESA_DA_CONFRARIA = 1;
const VINHO = "Vinho da Confraria";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** O Intl separa "R$" do valor com espaço não separável; a comparação é pelo texto normalizado. */
const normalizar = (texto: string) => texto.replace(/\s+/g, " ").trim();
/** Só formata o preço que o banco mandou, para procurá-lo na tela. Não calcula nada (JM-031). */
const preco = (valor: number) => normalizar(brl.format(Number(valor)));

async function cardapio(request: APIRequestContext, token: string): Promise<Menu> {
  const r = await request.get("/api/tablet/cardapio", { headers: { "x-device-token": token } });
  expect(r.status()).toBe(200);
  return (await r.json()) as Menu;
}

/** Total do item pela rota do tablet: só identificadores e quantidade (JM-031). */
function total(request: APIRequestContext, token: string, produtoId: string, opcoes: string[] = []) {
  return request.post("/api/tablet/total", {
    headers: { "x-device-token": token },
    data: { product_id: produtoId, quantity: 1, option_ids: opcoes },
  });
}

function produto(m: Menu, nome: string) {
  const p = m.products.find((x) => x.name === nome);
  if (!p) throw new Error(`"${nome}" não está no cardápio de ${m.store.name}.`);
  return p;
}

/** A recusa não carrega total: nem no erro sai preço de produto que não é da loja. */
async function recusado(resposta: APIResponse, status: number, codigo: string) {
  expect(resposta.status()).toBe(status);
  const corpo = (await resposta.json()) as Record<string, unknown>;
  expect(corpo.codigo).toBe(codigo);
  expect(corpo).not.toHaveProperty("unit_total");
  expect(corpo).not.toHaveProperty("line_total");
  return corpo;
}

/** Tudo o que o banco devolveu é da loja do token, e de nenhuma outra (JM-100). */
function conferirCardapio(m: Menu, slug: string) {
  expect(m.store.slug).toBe(slug);
  expect(m.categories.length).toBeGreaterThan(0);
  expect(m.products.length).toBeGreaterThan(0);
  for (const c of m.categories) expect(c.store_id, `categoria ${c.name}`).toBe(m.store.id);
  for (const p of m.products) expect(p.store_id, `produto ${p.name}`).toBe(m.store.id);
}

/**
 * A tela mostra o cardápio da própria loja, e nada da outra: as categorias na coluna (no alvo
 * de 1280x800, em paisagem, JM-007), um card por produto em "Tudo", com nome e preço, e nenhum
 * nome, categoria ou preço alheio no texto da tela. Preço que as duas lojas praticam não prova
 * vazamento nenhum, e fica fora da busca.
 */
async function conferirTela(tablet: Page, proprio: Menu, alheio: Menu) {
  const categorias = tablet.getByRole("navigation", { name: "Categorias" });
  await expect(categorias.getByRole("button")).toHaveText(["Tudo", ...proprio.categories.map((c) => c.name)]);

  await expect(tablet.locator("[data-produto]")).toHaveCount(proprio.products.length);
  for (const p of proprio.products) {
    const card = tablet.locator(`[data-produto="${p.id}"]`);
    await expect(card).toContainText(p.name);
    await expect(card).toContainText(preco(p.price));
  }

  for (const c of alheio.categories) {
    await expect(categorias.getByRole("button", { name: c.name })).toHaveCount(0);
  }
  for (const p of alheio.products) {
    await expect(tablet.locator(`[data-produto="${p.id}"]`)).toHaveCount(0);
    await expect(tablet.getByText(p.name)).toHaveCount(0);
  }

  const precosProprios = new Set(proprio.products.map((p) => preco(p.price)));
  const texto = normalizar(await tablet.locator("body").innerText());
  for (const p of alheio.products) {
    const valor = preco(p.price);
    if (!precosProprios.has(valor)) expect(texto, `preço de ${p.name}`).not.toContain(valor);
  }
}

test("E2E-14: duas lojas não vazam categoria, produto nem preço, e produto indisponível deixa de ser adicionável", async ({
  browser,
  request,
}) => {
  // Dois pareamentos, um login no admin e duas esperas pelo ciclo de 10 s do cardápio não
  // cabem com folga nos 90 s padrão.
  test.slow();

  const jardim = await parearTabletDaLoja(browser, LOJA, GESTOR, MESA_DO_JARDIM);
  const confraria = await parearTabletDaLoja(browser, LOJA_CONFRARIA, GESTOR_CONFRARIA, MESA_DA_CONFRARIA);
  const tJardim = await tokenDoTablet(jardim);
  const tConfraria = await tokenDoTablet(confraria);
  expect(tJardim).not.toBe("");
  expect(tConfraria).not.toBe("");
  expect(tJardim).not.toBe(tConfraria);

  // 1. O banco: cada token recebe só a própria loja, e os dois cardápios não se tocam.
  const mJardim = await cardapio(request, tJardim);
  const mConfraria = await cardapio(request, tConfraria);
  conferirCardapio(mJardim, LOJA);
  conferirCardapio(mConfraria, LOJA_CONFRARIA);
  expect(mConfraria.categories.map((c) => c.name)).toEqual(["Vinhos"]);
  expect(mConfraria.products.map((p) => p.name)).toEqual([VINHO]);
  const idsDoJardim = new Set([...mJardim.categories, ...mJardim.products].map((x) => x.id));
  expect([...mConfraria.categories, ...mConfraria.products].filter((x) => idsDoJardim.has(x.id))).toEqual([]);

  const vinho = produto(mConfraria, VINHO);
  const chopp = produto(mJardim, "Chopp Pilsen da casa");
  const bacon = mJardim.products
    .flatMap((p) => p.option_groups.flatMap((g) => g.options))
    .find((o) => o.name === "Bacon artesanal");
  if (!bacon) throw new Error('O complemento "Bacon artesanal" não está no cardápio do Jardim.');

  // 2. A tela de cada tablet, conferida contra o que o banco mandou para ele.
  await conferirTela(jardim, mJardim, mConfraria);
  await conferirTela(confraria, mConfraria, mJardim);
  await expect(confraria.locator(`[data-produto="${vinho.id}"]`)).toContainText("R$ 60,00");

  // A loja da URL não decide nada: quem decide é o token (JM-100). O tablet da Confraria no
  // endereço do Jardim continua mostrando o cardápio da Confraria, e nenhum produto ou
  // categoria do Jardim aparece.
  const noEnderecoAlheio = await confraria.context().newPage();
  await noEnderecoAlheio.goto(`/${LOJA}/tablet`);
  await expect(noEnderecoAlheio.locator(`[data-produto="${vinho.id}"]`)).toBeVisible();
  for (const p of mJardim.products) {
    await expect(noEnderecoAlheio.getByText(p.name)).toHaveCount(0);
  }
  for (const c of mJardim.categories) {
    await expect(noEnderecoAlheio.getByRole("button", { name: c.name, exact: true })).toHaveCount(0);
  }
  await noEnderecoAlheio.close();

  // 3. O total no servidor (JM-031): o da própria loja sai, com o preço do cardápio; o produto
  // e o complemento da outra loja são recusados, sem dizer preço nem nome.
  const doVinho = await total(request, tConfraria, vinho.id);
  expect(doVinho.status()).toBe(200);
  expect(Number((await doVinho.json()).unit_total)).toBe(Number(vinho.price));
  const doChopp = await total(request, tJardim, chopp.id);
  expect(doChopp.status()).toBe(200);
  expect(Number((await doChopp.json()).unit_total)).toBe(Number(chopp.price));

  const vinhoNoJardim = await recusado(await total(request, tJardim, vinho.id), 404, "JM404");
  expect(vinhoNoJardim).toEqual({ codigo: "JM404", mensagem: "Não encontrado." });
  const choppNaConfraria = await recusado(await total(request, tConfraria, chopp.id), 404, "JM404");
  expect(choppNaConfraria).toEqual({ codigo: "JM404", mensagem: "Não encontrado." });
  await recusado(await total(request, tConfraria, vinho.id, [bacon.id]), 422, "JM422");

  // 4. Antes de ficar indisponível, o vinho é adicionável: o modal mostra o total que o
  // servidor calculou, e ele entra na sacola. Este é o único toque na tela de um cliente, e
  // acontece na mesa 1 da Confraria, que nenhum outro spec usa: ele abre a abertura dela
  // (JM-182), e nada é enviado.
  const card = confraria.locator(`[data-produto="${vinho.id}"]`);
  await card.getByRole("button").click();
  const modal = confraria.getByRole("dialog", { name: VINHO });
  const botaoAdicionar = modal.getByRole("button", { name: `Adicionar · ${preco(vinho.price)}` });
  await expect(botaoAdicionar).toBeEnabled();
  await botaoAdicionar.click();
  await expect(modal).toBeHidden();
  await expect(confraria.getByRole("button", { name: /Sacola, 1 item/ })).toBeVisible();

  // 5. O gestor da Confraria marca o vinho indisponível pelo admin dele (JM-004). O admin
  // também é só da Confraria: o chopp do Jardim não aparece na lista de produtos.
  const admin = await entrarNoAdmin(browser, "/admin/cardapio", GESTOR_CONFRARIA);
  const chave = admin.getByRole("switch", { name: `Disponibilidade de ${VINHO}` });
  await expect(chave).toHaveAttribute("aria-checked", "true");
  await expect(admin.getByText(chopp.name)).toHaveCount(0);

  await chave.click();
  await expect(chave).toHaveAttribute("aria-checked", "false");
  try {
    // O cardápio é relido a cada 10 s: o card esmaece e o botão trava (JM-004, P7).
    await expect(card).toContainText("Indisponível", { timeout: 12_000 });
    await expect(card.getByRole("button")).toBeDisabled();

    // Quem passar por fora da tela também não adiciona: o servidor recusa o total.
    const indisponivel = await recusado(await total(request, tConfraria, vinho.id), 409, "JM451");
    expect(indisponivel.mensagem).toBe(`Produto indisponível agora: ${VINHO}.`);

    // A indisponibilidade é da Confraria: o Jardim segue igual.
    expect((await total(request, tJardim, chopp.id)).status()).toBe(200);
    await expect(jardim.locator(`[data-produto="${chopp.id}"]`).getByRole("button")).toBeEnabled();
  } finally {
    // A massa volta como estava: o spec pode rodar de novo sem `supabase db reset`.
    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "true");
  }

  // De volta ao disponível, o vinho volta a ser adicionável no próximo ciclo do cardápio.
  await expect(card.getByRole("button")).toBeEnabled({ timeout: 12_000 });
  await expect(card).not.toContainText("Indisponível");
});
