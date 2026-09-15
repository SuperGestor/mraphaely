"use client";

import { useCallback, useEffect, useState } from "react";
import { mensagemDe, type CardapioAdmin, type GrupoAdmin, type OpcaoAdmin } from "@/lib/admin-source";
import { useAdmin } from "@/components/admin/AdminContext";
import { money, moneyDelta } from "@/lib/money";
import { Badge, Button, Cell, Field, Hint, PageHeader, Panel, Row, Switch, Table, TextInput } from "@/components/admin/ui";

/**
 * Grupos de complementos e opções (JM-003, JM-050). Grupo com mínimo 1 é o que trava o
 * botão de adicionar no tablet até a escolha. O quanto cada opção soma é conferido e
 * aplicado no servidor (JM-031): a tela só cadastra.
 *
 * Ligar um grupo a um produto é feito na edição do produto, no Cardápio.
 */
export default function AdminComplementos() {
  const { source, loja, gestor } = useAdmin();
  const [dados, setDados] = useState<CardapioAdmin | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [novoGrupo, setNovoGrupo] = useState({ name: "", min: "0", max: "1" });
  const [novaOpcao, setNovaOpcao] = useState<Record<string, { name: string; delta: string }>>({});

  const carregar = useCallback(() => {
    source
      .cardapio(loja.store_id)
      .then(setDados)
      .catch((e: unknown) => setErro(mensagemDe(e)));
  }, [source, loja.store_id]);

  useEffect(carregar, [carregar]);

  async function executar(acao: () => Promise<unknown>, sucesso?: string): Promise<boolean> {
    setAviso(null);
    try {
      await acao();
      if (sucesso) setAviso(sucesso);
      carregar();
      return true;
    } catch (e: unknown) {
      setAviso(mensagemDe(e));
      return false;
    }
  }

  const inteiro = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const dinheiro = (v: string) => Math.round(Number(v.replace(",", ".")) * 100) / 100;

  async function criarGrupo() {
    const ok = await executar(
      () =>
        source.rpc("admin_upsert_option_group", {
          p_store_id: loja.store_id,
          p_id: null,
          p_name: novoGrupo.name.trim(),
          p_min_select: inteiro(novoGrupo.min),
          p_max_select: Math.max(1, inteiro(novoGrupo.max)),
        }),
      "Grupo criado.",
    );
    if (ok) setNovoGrupo({ name: "", min: "0", max: "1" });
  }

  function salvarGrupo(g: GrupoAdmin, mudanca: Partial<GrupoAdmin>) {
    return executar(() =>
      source.rpc("admin_upsert_option_group", {
        p_store_id: loja.store_id,
        p_id: g.id,
        p_name: (mudanca.name ?? g.name).trim(),
        p_min_select: mudanca.min_select ?? g.min_select,
        p_max_select: mudanca.max_select ?? g.max_select,
      }),
    );
  }

  function salvarOpcao(o: OpcaoAdmin, mudanca: Partial<OpcaoAdmin>) {
    return executar(() =>
      source.rpc("admin_upsert_option", {
        p_group_id: o.group_id,
        p_id: o.id,
        p_name: (mudanca.name ?? o.name).trim(),
        p_price_delta: mudanca.price_delta ?? o.price_delta,
        p_pdv_code: mudanca.pdv_code === undefined ? o.pdv_code : mudanca.pdv_code,
        p_is_available: mudanca.is_available ?? o.is_available,
        p_sort_order: mudanca.sort_order ?? o.sort_order,
      }),
    );
  }

  async function criarOpcao(g: GrupoAdmin) {
    const rascunho = novaOpcao[g.id] ?? { name: "", delta: "0" };
    const delta = dinheiro(rascunho.delta);
    if (!rascunho.name.trim() || !Number.isFinite(delta) || delta < 0) {
      setAviso("Nome e valor que soma ao preço, zero ou mais, são obrigatórios.");
      return;
    }
    const ok = await executar(
      () =>
        source.rpc("admin_upsert_option", {
          p_group_id: g.id,
          p_id: null,
          p_name: rascunho.name.trim(),
          p_price_delta: delta,
          p_pdv_code: null,
          p_is_available: true,
          p_sort_order: g.options.length + 1,
        }),
      "Opção criada.",
    );
    if (ok) setNovaOpcao((n) => ({ ...n, [g.id]: { name: "", delta: "0" } }));
  }

  const usadoEm = (grupoId: string) =>
    (dados?.ligacoes ?? [])
      .filter((l) => l.group_id === grupoId)
      .map((l) => dados?.produtos.find((p) => p.id === l.product_id)?.name)
      .filter(Boolean)
      .join(", ");

  return (
    <>
      <PageHeader
        titulo="Complementos"
        descricao="Grupos de escolha do cardápio, com mínimo, máximo e o quanto cada opção soma."
      />

      {aviso ? (
        <div className="mb-4">
          <Hint>{aviso}</Hint>
        </div>
      ) : null}

      {gestor ? (
        <Panel titulo="Novo grupo" descricao="Mínimo 1 torna o grupo obrigatório no tablet.">
          <div className="grid gap-4 min-[1100px]:grid-cols-[2fr_1fr_1fr_auto] min-[1100px]:items-end">
            <Field rotulo="Nome">
              <TextInput value={novoGrupo.name} maxLength={40} onChange={(e) => setNovoGrupo({ ...novoGrupo, name: e.target.value })} />
            </Field>
            <Field rotulo="Mínimo">
              <TextInput inputMode="numeric" value={novoGrupo.min} onChange={(e) => setNovoGrupo({ ...novoGrupo, min: e.target.value })} />
            </Field>
            <Field rotulo="Máximo">
              <TextInput inputMode="numeric" value={novoGrupo.max} onChange={(e) => setNovoGrupo({ ...novoGrupo, max: e.target.value })} />
            </Field>
            <div className="mb-6">
              <Button onClick={criarGrupo} disabled={!novoGrupo.name.trim()}>
                Criar grupo
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {erro ? (
        <Hint>{erro}</Hint>
      ) : !dados ? (
        <Panel>
          <p className="text-muted">Carregando…</p>
        </Panel>
      ) : (
        dados.grupos.map((g) => {
          const rascunho = novaOpcao[g.id] ?? { name: "", delta: "0" };
          const usado = usadoEm(g.id);
          return (
            <Panel key={g.id} titulo={g.name} descricao={usado ? `Usado em: ${usado}` : "Ainda não ligado a nenhum produto."}>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Badge tom={g.min_select > 0 ? "alerta" : "neutro"}>{g.min_select > 0 ? "Obrigatório" : "Opcional"}</Badge>
                {gestor ? (
                  <>
                    <span className="text-muted text-sm">Mínimo</span>
                    <TextInput
                      defaultValue={String(g.min_select)}
                      inputMode="numeric"
                      className="max-w-20"
                      aria-label={`Mínimo de ${g.name}`}
                      onBlur={(e) => {
                        const v = inteiro(e.target.value);
                        if (v !== g.min_select) void salvarGrupo(g, { min_select: v });
                      }}
                    />
                    <span className="text-muted text-sm">Máximo</span>
                    <TextInput
                      defaultValue={String(g.max_select)}
                      inputMode="numeric"
                      className="max-w-20"
                      aria-label={`Máximo de ${g.name}`}
                      onBlur={(e) => {
                        const v = Math.max(1, inteiro(e.target.value));
                        if (v !== g.max_select) void salvarGrupo(g, { max_select: v });
                      }}
                    />
                  </>
                ) : (
                  <span className="text-muted text-sm">
                    Escolha de {g.min_select} a {g.max_select}
                  </span>
                )}
              </div>

              <Table colunas={["Opção", "Soma ao preço", "Código no PDV", "Disponível"]}>
                {g.options.map((o) => (
                  <Row key={o.id}>
                    <Cell>{o.name}</Cell>
                    <Cell>{moneyDelta(o.price_delta) ?? money(0)}</Cell>
                    <Cell>
                      <TextInput
                        defaultValue={o.pdv_code ?? ""}
                        maxLength={40}
                        disabled={!gestor}
                        placeholder="sem código"
                        aria-label={`Código no PDV de ${o.name}`}
                        className="max-w-40"
                        onBlur={(e) => {
                          const codigo = e.target.value.trim() || null;
                          if (codigo !== o.pdv_code) void salvarOpcao(o, { pdv_code: codigo });
                        }}
                      />
                    </Cell>
                    <Cell alinhar="right">
                      <Switch
                        ligado={o.is_available}
                        onChange={(v) => gestor && void salvarOpcao(o, { is_available: v })}
                        rotulo={`Opção ${o.name} disponível`}
                      />
                    </Cell>
                  </Row>
                ))}
              </Table>

              {gestor ? (
                <div className="mt-4 flex items-end gap-3">
                  <div className="flex-1">
                    <TextInput
                      value={rascunho.name}
                      maxLength={40}
                      placeholder="Nova opção"
                      aria-label={`Nova opção em ${g.name}`}
                      onChange={(e) => setNovaOpcao((n) => ({ ...n, [g.id]: { ...rascunho, name: e.target.value } }))}
                    />
                  </div>
                  <div className="w-36">
                    <TextInput
                      value={rascunho.delta}
                      inputMode="decimal"
                      aria-label={`Quanto a nova opção soma em ${g.name}`}
                      onChange={(e) => setNovaOpcao((n) => ({ ...n, [g.id]: { ...rascunho, delta: e.target.value } }))}
                    />
                  </div>
                  <Button variante="secundario" onClick={() => criarOpcao(g)} disabled={!rascunho.name.trim()}>
                    Adicionar opção
                  </Button>
                </div>
              ) : null}
            </Panel>
          );
        })
      )}
    </>
  );
}
