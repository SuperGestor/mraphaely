"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeviceRow } from "@/lib/types";
import { mensagemDe } from "@/lib/admin-source";
import { useAdmin } from "@/components/admin/AdminContext";
import { Badge, Button, Cell, Hint, PageHeader, Panel, Row, Table } from "@/components/admin/ui";

/**
 * Dispositivos (JM-180, JM-184).
 *
 * Parear é no próprio tablet, com o login do dono ou do gestor (decisão de 21/09/2026): esta
 * tela explica o caminho e cuida do resto, que é desativar, reativar e aposentar. Ela nunca
 * mostra o token, que nasce no tablet e fica só como sha256 no banco (NF-006).
 */

/** Rótulo de último contato. É exibição, não regra: o limite de 5 min é do servidor. */
function contato(iso: string | null): { texto: string; alerta: boolean } {
  if (!iso) return { texto: "nunca", alerta: true };
  const minutos = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutos < 1) return { texto: "agora", alerta: false };
  if (minutos < 60) return { texto: `há ${minutos} min`, alerta: minutos > 5 };
  return { texto: `há ${Math.floor(minutos / 60)} h`, alerta: true };
}

function estado(d: DeviceRow) {
  if (d.status === "retired") return <Badge tom="erro">Aposentado</Badge>;
  if (d.status === "inactive") return <Badge tom="alerta">Desativado</Badge>;
  return <Badge tom="ok">Ativo</Badge>;
}

export default function AdminDispositivos() {
  const { source, loja, gestor } = useAdmin();
  const [dispositivos, setDispositivos] = useState<DeviceRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [origem, setOrigem] = useState("");

  useEffect(() => setOrigem(window.location.origin), []);

  const carregar = useCallback(() => {
    source
      .dispositivos(loja.store_id)
      .then(setDispositivos)
      .catch((e: unknown) => setErro(mensagemDe(e)));
  }, [source, loja.store_id]);

  useEffect(carregar, [carregar]);

  async function alterar(d: DeviceRow, status: "active" | "inactive" | "retired") {
    if (status === "retired") {
      const certeza = window.confirm(`Aposentar "${d.name}"? O token dele para de funcionar e não volta.`);
      if (!certeza) return;
    }
    setAviso(null);
    try {
      await source.alterarDispositivo(d.id, { acao: "estado", status });
      carregar();
    } catch (e: unknown) {
      setAviso(mensagemDe(e));
    }
  }

  const enderecoDeConfiguracao = `${origem}/${loja.slug}/tablet/setup`;

  return (
    <>
      <PageHeader
        titulo="Dispositivos"
        descricao="Os tablets da casa, um por mesa: estado, versão, bateria e último contato."
      />

      {aviso ? (
        <div className="mb-4">
          <Hint>{aviso}</Hint>
        </div>
      ) : null}

      <Panel titulo="Como parear um tablet" descricao="No próprio tablet, com o seu login. Só o dono e o gestor pareiam.">
        <ol className="list-decimal space-y-2 pl-6 text-base">
          <li>
            No navegador do tablet, abra <code className="break-all">{enderecoDeConfiguracao}</code>.
          </li>
          <li>Entre com o seu e-mail e senha da equipe e informe o número da mesa.</li>
          <li>
            Pronto: o tablet fica pareado com a mesa, e o seu login não fica no aparelho. Parear de novo uma mesa
            aposenta o tablet que estava nela.
          </li>
        </ol>
      </Panel>

      <Panel titulo={dispositivos ? `${dispositivos.length} dispositivo(s)` : "Dispositivos"}>
        {erro ? (
          <Hint>{erro}</Hint>
        ) : !dispositivos ? (
          <p className="text-muted">Carregando…</p>
        ) : dispositivos.length === 0 ? (
          <p className="text-muted">Nenhum tablet pareado ainda.</p>
        ) : (
          <Table colunas={["Aparelho", "Mesa", "Bateria", "Último contato", "Estado", ""]}>
            {dispositivos.map((d) => {
              const c = contato(d.last_seen_at);
              const bateriaBaixa = (d.battery_level ?? 100) < 20;
              return (
                <Row key={d.id}>
                  <Cell>
                    <span className="font-semibold">{d.name}</span>
                    <span className="text-muted block text-sm">versão {d.app_version ?? "—"}</span>
                  </Cell>
                  <Cell>{d.table_number ?? "sem mesa"}</Cell>
                  <Cell>
                    {d.battery_level === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className={bateriaBaixa ? "text-danger font-bold" : ""}>{d.battery_level}%</span>
                    )}
                  </Cell>
                  <Cell>
                    <span className={c.alerta && d.status === "active" ? "text-danger font-semibold" : ""}>{c.texto}</span>
                  </Cell>
                  <Cell>{estado(d)}</Cell>
                  <Cell alinhar="right">
                    {gestor && d.status !== "retired" ? (
                      <div className="flex justify-end gap-2">
                        {d.status === "active" ? (
                          <Button variante="secundario" onClick={() => alterar(d, "inactive")}>
                            Desativar
                          </Button>
                        ) : (
                          <Button variante="secundario" onClick={() => alterar(d, "active")}>
                            Reativar
                          </Button>
                        )}
                        <Button variante="secundario" onClick={() => alterar(d, "retired")}>
                          Aposentar
                        </Button>
                      </div>
                    ) : null}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Panel>
    </>
  );
}
