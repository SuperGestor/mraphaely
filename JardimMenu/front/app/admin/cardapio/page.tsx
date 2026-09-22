"use client";

import { useCallback, useEffect, useState } from "react";
import { mensagemDe, type CardapioAdmin, type CategoriaAdmin, type ProdutoAdmin } from "@/lib/admin-source";
import { useAdmin } from "@/components/admin/AdminContext";
import { money } from "@/lib/money";
import { urlDaFoto } from "@/lib/foto";
import { Badge, Button, Cell, Field, Hint, PageHeader, Panel, Row, Switch, Table, TextInput } from "@/components/admin/ui";
import { EditorDeJanela } from "@/components/admin/EditorDeJanela";
import { lerJanela, primeiroProblemaDaJanela } from "@/lib/janela-do-produto";

/**
 * Cardápio (JM-050): categorias e produtos, com disponibilidade em 1 toque (JM-004),
 * código do PDV (JM-190), grupos de complemento do produto, foto (JM-002) e horário do
 * produto, almoço x jantar (JM-006).
 *
 * Toda gravação é uma function do banco, que confere papel, loja e formato. O que a tela
 * valida é só conforto; a regra está lá.
 */
const SELECT = "rounded-input border-line bg-canvas jm-touch jm-focus w-full border-2 px-4 text-base";

interface Rascunho {
  id: string | null;
  category_id: string;
  name: string;
  description: string;
  price: string;
  emoji: string;
  is_featured: boolean;
  pdv_code: string;
  sort_order: string;
  is_active: boolean;
  grupos: string[];
  available_window: ProdutoAdmin["available_window"];
  photo_path: string | null;
}

export default function AdminCardapio() {
  const { source, loja, gestor } = useAdmin();
  const [dados, setDados] = useState<CardapioAdmin | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [novaCategoria, setNovaCategoria] = useState("");
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [salvando, setSalvando] = useState(false);
  // A recusa ao gravar o produto aparece junto do botão, e não no topo: no celular o
  // formulário é comprido, e o aviso lá em cima ficaria fora da tela de quem tocou.
  const [erroDoProduto, setErroDoProduto] = useState<string | null>(null);
  // Cada abertura do formulário remonta o editor de horário, para as faixas guardadas de
  // um produto não vazarem para o próximo.
  const [abertura, setAbertura] = useState(0);

  const carregar = useCallback(() => {
    source
      .cardapio(loja.store_id)
      .then(setDados)
      .catch((e: unknown) => setErro(mensagemDe(e)));
  }, [source, loja.store_id]);

  useEffect(carregar, [carregar]);

  async function executar(
    acao: () => Promise<unknown>,
    sucesso?: string,
    mostrarErro: (mensagem: string) => void = setAviso,
  ): Promise<boolean> {
    setAviso(null);
    try {
      await acao();
      if (sucesso) setAviso(sucesso);
      carregar();
      return true;
    } catch (e: unknown) {
      mostrarErro(mensagemDe(e));
      return false;
    }
  }

  // ---------- categorias ----------
  async function criarCategoria() {
    const ok = await executar(
      () =>
        source.rpc("admin_upsert_category", {
          p_store_id: loja.store_id,
          p_id: null,
          p_name: novaCategoria.trim(),
          p_sort_order: (dados?.categorias.length ?? 0) + 1,
          p_is_active: true,
        }),
      "Categoria criada.",
    );
    if (ok) setNovaCategoria("");
  }

  function salvarCategoria(c: CategoriaAdmin, mudanca: Partial<CategoriaAdmin>) {
    return executar(() =>
      source.rpc("admin_upsert_category", {
        p_store_id: loja.store_id,
        p_id: c.id,
        p_name: (mudanca.name ?? c.name).trim(),
        p_sort_order: mudanca.sort_order ?? c.sort_order,
        p_is_active: mudanca.is_active ?? c.is_active,
      }),
    );
  }

  // ---------- produtos ----------
  function novoProduto() {
    if (!dados?.categorias.length) {
      setAviso("Crie uma categoria antes do primeiro produto.");
      return;
    }
    setErroDoProduto(null);
    setAbertura((n) => n + 1);
    setRascunho({
      id: null,
      category_id: dados.categorias[0].id,
      name: "",
      description: "",
      price: "",
      emoji: "",
      is_featured: false,
      pdv_code: "",
      sort_order: String(dados.produtos.length + 1),
      is_active: true,
      grupos: [],
      available_window: null,
      photo_path: null,
    });
  }

  function editar(p: ProdutoAdmin) {
    if (!dados) return;
    setErroDoProduto(null);
    setAbertura((n) => n + 1);
    setRascunho({
      id: p.id,
      category_id: p.category_id,
      name: p.name,
      description: p.description ?? "",
      price: String(p.price),
      emoji: p.emoji ?? "",
      is_featured: p.is_featured,
      pdv_code: p.pdv_code ?? "",
      sort_order: String(p.sort_order),
      is_active: p.is_active,
      grupos: dados.ligacoes
        .filter((l) => l.product_id === p.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => l.group_id),
      // O jsonb do banco passa pelo zod de lib/janela-do-produto.ts: dia em texto vira
      // número e chave a mais sai, senão o zod estrito do servidor recusaria a volta sem o
      // gestor ter mexido no horário.
      available_window: lerJanela(p.available_window),
      photo_path: p.photo_path,
    });
  }

  async function salvarProduto() {
    if (!rascunho) return;
    setErroDoProduto(null);
    const preco = Number(rascunho.price.replace(",", "."));
    if (!rascunho.name.trim() || !Number.isFinite(preco) || preco < 0) {
      setErroDoProduto("Nome e preço válido são obrigatórios.");
      return;
    }
    // Conforto: aponta a faixa errada antes de ir ao servidor. A regra de verdade é a do
    // banco (jm_windows_valid), e a recusa dele, se vier, aparece no mesmo lugar.
    const problemaDaJanela = primeiroProblemaDaJanela(rascunho.available_window);
    if (problemaDaJanela) {
      setErroDoProduto(`Horário do produto. ${problemaDaJanela}`);
      return;
    }
    setSalvando(true);
    const ok = await executar(async () => {
      const id = await source.rpc("admin_upsert_product", {
        p_store_id: loja.store_id,
        p_id: rascunho.id,
        p_category_id: rascunho.category_id,
        p_name: rascunho.name.trim(),
        p_description: rascunho.description.trim() || null,
        p_price: Math.round(preco * 100) / 100,
        p_emoji: rascunho.emoji.trim() || null,
        p_is_featured: rascunho.is_featured,
        // Janela por produto (JM-006): nulo é sempre disponível; a lista vai como o editor
        // montou, em hora local da loja, e o banco confere o formato de novo.
        p_available_window: rascunho.available_window,
        p_pdv_code: rascunho.pdv_code.trim() || null,
        p_sort_order: Math.max(0, Math.floor(Number(rascunho.sort_order) || 0)),
        p_is_active: rascunho.is_active,
      });
      await source.rpc("admin_set_product_groups", { p_product_id: String(id), p_group_ids: rascunho.grupos });
    }, rascunho.id ? "Produto salvo." : "Produto criado.", setErroDoProduto);
    setSalvando(false);
    if (ok) setRascunho(null);
  }

  async function enviarFoto(arquivo: File) {
    if (!rascunho?.id) return;
    const id = rascunho.id;
    await executar(async () => {
      const caminho = await source.enviarFoto(id, arquivo);
      setRascunho((r) => (r ? { ...r, photo_path: caminho } : r));
    }, "Foto enviada: três larguras em WebP, dentro dos tetos da §18.4.");
  }

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const produtos = (dados?.produtos ?? []).filter((p) =>
    termo ? p.name.toLocaleLowerCase("pt-BR").includes(termo) : true,
  );
  const nomeDaCategoria = (id: string) => dados?.categorias.find((c) => c.id === id)?.name ?? "";
  const miniatura = rascunho ? urlDaFoto(rascunho.photo_path, "grade") : null;

  return (
    <>
      <PageHeader
        titulo="Cardápio"
        descricao="Categorias e produtos, com preço, código no PDV, complementos, foto, horário do produto e disponibilidade do dia."
        acao={
          <div className="flex w-full items-center gap-3 sm:w-auto">
            <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
              <TextInput
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar produto"
                aria-label="Buscar produto"
              />
            </div>
            {gestor ? <Button onClick={novoProduto}>Novo produto</Button> : null}
          </div>
        }
      />

      {aviso ? (
        <div className="mb-4">
          <Hint>{aviso}</Hint>
        </div>
      ) : null}

      {rascunho ? (
        <Panel titulo={rascunho.id ? `Editar: ${rascunho.name || "produto"}` : "Novo produto"}>
          <div className="grid gap-x-6 min-[1100px]:grid-cols-2">
            <Field rotulo="Nome">
              <TextInput value={rascunho.name} maxLength={80} onChange={(e) => setRascunho({ ...rascunho, name: e.target.value })} />
            </Field>
            <Field rotulo="Categoria">
              <select
                className={SELECT}
                value={rascunho.category_id}
                onChange={(e) => setRascunho({ ...rascunho, category_id: e.target.value })}
              >
                {dados?.categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_active ? "" : " (inativa)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field rotulo="Preço" ajuda="O preço do cardápio. O total com complementos é calculado no servidor.">
              <TextInput inputMode="decimal" value={rascunho.price} onChange={(e) => setRascunho({ ...rascunho, price: e.target.value })} />
            </Field>
            <Field rotulo="Código no PDV" ajuda="Aparece para a equipe, nunca para o cliente (JM-190).">
              <TextInput value={rascunho.pdv_code} maxLength={40} onChange={(e) => setRascunho({ ...rascunho, pdv_code: e.target.value })} />
            </Field>
            <Field rotulo="Descrição">
              <TextInput
                value={rascunho.description}
                maxLength={280}
                onChange={(e) => setRascunho({ ...rascunho, description: e.target.value })}
              />
            </Field>
            <Field rotulo="Emoji" ajuda="Placeholder do produto sem foto.">
              <TextInput value={rascunho.emoji} maxLength={8} onChange={(e) => setRascunho({ ...rascunho, emoji: e.target.value })} />
            </Field>
            <Field rotulo="Ordem">
              <TextInput inputMode="numeric" value={rascunho.sort_order} onChange={(e) => setRascunho({ ...rascunho, sort_order: e.target.value })} />
            </Field>
            <div className="mb-6 flex items-center gap-8">
              <Switch ligado={rascunho.is_featured} onChange={(v) => setRascunho({ ...rascunho, is_featured: v })} rotulo="Na vitrine" />
              <span className="text-base">Na vitrine</span>
              <Switch ligado={rascunho.is_active} onChange={(v) => setRascunho({ ...rascunho, is_active: v })} rotulo="Ativo no cardápio" />
              <span className="text-base">Ativo</span>
            </div>
          </div>

          <EditorDeJanela
            key={abertura}
            valor={rascunho.available_window}
            onChange={(v) => setRascunho((r) => (r ? { ...r, available_window: v } : r))}
          />

          <Field rotulo="Grupos de complemento" ajuda="Na ordem em que aparecem no modal do tablet.">
            <div className="flex flex-wrap gap-2">
              {dados?.grupos.map((g) => {
                const marcado = rascunho.grupos.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={marcado}
                    onClick={() =>
                      setRascunho({
                        ...rascunho,
                        grupos: marcado ? rascunho.grupos.filter((x) => x !== g.id) : [...rascunho.grupos, g.id],
                      })
                    }
                    className={`jm-touch jm-focus rounded-full border-2 px-4 text-base ${
                      marcado ? "border-primary bg-primary text-white" : "border-line bg-canvas"
                    }`}
                  >
                    {g.name}
                  </button>
                );
              })}
              {!dados?.grupos.length ? <span className="text-muted">Nenhum grupo criado ainda.</span> : null}
            </div>
          </Field>

          {rascunho.id ? (
            <Field rotulo="Foto" ajuda="JPEG, PNG ou WebP, até 400 KB e no mínimo 800 px no menor lado. O corte é 4:3.">
              <div className="flex items-center gap-4">
                {miniatura ? (
                  // eslint-disable-next-line @next/next/no-img-element -- miniatura servida pelo Storage
                  <img src={miniatura} alt="" width={120} height={90} className="rounded-input object-cover" />
                ) : (
                  <span className="text-muted">sem foto</span>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Enviar foto do produto"
                  onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    if (arquivo) void enviarFoto(arquivo);
                    e.target.value = "";
                  }}
                  className="jm-focus text-base"
                />
              </div>
            </Field>
          ) : (
            <Hint>A foto é enviada depois que o produto existe: salve primeiro.</Hint>
          )}

          {erroDoProduto ? (
            <p className="text-danger mt-6 text-sm font-semibold" role="alert">
              {erroDoProduto}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={salvarProduto} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar produto"}
            </Button>
            <Button variante="secundario" onClick={() => setRascunho(null)}>
              Cancelar
            </Button>
          </div>
        </Panel>
      ) : null}

      <Panel titulo="Categorias" descricao="A ordem daqui é a ordem da coluna de categorias no tablet (JM-001).">
        {gestor ? (
          <div className="mb-4 flex items-end gap-3">
            <div className="flex-1">
              <TextInput
                value={novaCategoria}
                onChange={(e) => setNovaCategoria(e.target.value)}
                placeholder="Nova categoria"
                maxLength={40}
                aria-label="Nome da nova categoria"
              />
            </div>
            <Button onClick={criarCategoria} disabled={!novaCategoria.trim()}>
              Criar
            </Button>
          </div>
        ) : null}
        <Table colunas={["Nome", "Ordem", "Ativa"]}>
          {(dados?.categorias ?? []).map((c) => (
            <Row key={c.id}>
              <Cell>
                <TextInput
                  defaultValue={c.name}
                  maxLength={40}
                  disabled={!gestor}
                  aria-label={`Nome da categoria ${c.name}`}
                  onBlur={(e) => {
                    const nome = e.target.value.trim();
                    if (nome && nome !== c.name) void salvarCategoria(c, { name: nome });
                  }}
                />
              </Cell>
              <Cell>
                <TextInput
                  defaultValue={String(c.sort_order)}
                  inputMode="numeric"
                  disabled={!gestor}
                  aria-label={`Ordem da categoria ${c.name}`}
                  className="max-w-24"
                  onBlur={(e) => {
                    const ordem = Math.max(0, Math.floor(Number(e.target.value) || 0));
                    if (ordem !== c.sort_order) void salvarCategoria(c, { sort_order: ordem });
                  }}
                />
              </Cell>
              <Cell alinhar="right">
                <Switch
                  ligado={c.is_active}
                  onChange={(v) => gestor && void salvarCategoria(c, { is_active: v })}
                  rotulo={`Categoria ${c.name} ativa`}
                />
              </Cell>
            </Row>
          ))}
        </Table>
      </Panel>

      <Panel titulo={`${produtos.length} produto(s)`}>
        {erro ? (
          <Hint>{erro}</Hint>
        ) : !dados ? (
          <p className="text-muted">Carregando…</p>
        ) : (
          <Table colunas={["Produto", "Categoria", "Preço", "Código no PDV", "Disponível hoje", ""]}>
            {produtos.map((p) => (
              <Row key={p.id}>
                <Cell>
                  <span className="font-semibold">{p.name}</span>
                  <span className="ml-2 inline-flex gap-1">
                    {p.is_featured ? <Badge tom="alerta">Vitrine</Badge> : null}
                    {!p.is_active ? <Badge tom="erro">Inativo</Badge> : null}
                    {p.photo_path ? <Badge tom="ok">Foto</Badge> : null}
                    {p.available_window !== null ? <Badge>Com horário</Badge> : null}
                  </span>
                </Cell>
                <Cell>{nomeDaCategoria(p.category_id)}</Cell>
                <Cell>{money(p.price)}</Cell>
                <Cell>{p.pdv_code ?? <span className="text-muted">sem código</span>}</Cell>
                <Cell>
                  <Switch
                    ligado={p.is_available}
                    onChange={(v) =>
                      void executar(() => source.rpc("staff_set_product_availability", { p_product_id: p.id, p_available: v }))
                    }
                    rotulo={`Disponibilidade de ${p.name}`}
                  />
                </Cell>
                <Cell alinhar="right">
                  {gestor ? (
                    <Button variante="secundario" onClick={() => editar(p)}>
                      Editar
                    </Button>
                  ) : null}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
