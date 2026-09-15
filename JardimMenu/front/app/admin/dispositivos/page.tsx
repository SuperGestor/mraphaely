"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeviceRow, TableRow } from "@/lib/types";
import { mensagemDe, type Pareamento } from "@/lib/admin-source";
import { useAdmin } from "@/components/admin/AdminContext";
import { Badge, Button, Cell, Field, Hint, PageHeader, Panel, Row, Table, TextInput } from "@/components/admin/ui";

/**
 * Dispositivos (JM-180, JM-184), com pareamento por código de uso único.
 *
 * O que esta tela nunca mostra é o token: ele nasce no pareamento, dentro do tablet, e o
 * banco guarda só o sha256 (NF-006). O que ela mostra, UMA vez, é o QR de configuração
 * com um código que vale 10 minutos e uma leitura. Fechou o painel, o código não volta:
 * gera-se outro.
 */

/** Rótulo de último contato. É exibição, não regra: o limite de 5 min é do servidor. */
function contato(iso: string | null): { texto: string; alerta: boolean } {
  if (!iso) return { texto: "nunca", alerta: true };
  const minutos = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutos < 1) return { texto: "agora", alerta: false };
  if (minutos < 60) return { texto: `há ${minutos} min`, alerta: minutos > 5 };
  return { texto: `há ${Math.floor(minutos / 60)} h`, alerta: true };
}

const horaCurta = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function estado(d: DeviceRow) {
  if (d.status === "retired") return <Badge tom="erro">Aposentado</Badge>;
  if (d.status === "inactive") return <Badge tom="alerta">Desativado</Badge>;
  return <Badge tom="ok">Ativo</Badge>;
}

function pareamento(d: DeviceRow) {
  if (d.status !== "active") return <span className="text-muted">—</span>;
  if (d.is_paired) return <Badge tom="ok">Pareado</Badge>;
  if (d.pairing_expires_at && Date.parse(d.pairing_expires_at) > Date.now()) {
    return <Badge tom="alerta">Aguardando até {horaCurta(d.pairing_expires_at)}</Badge>;
  }
  return <Badge tom="erro">Código vencido</Badge>;
}

export default function AdminDispositivos() {
  const { source, loja, gestor } = useAdmin();
  const [dispositivos, setDispositivos] = useState<DeviceRow[] | null>(null);
  const [mesas, setMesas] = useState<TableRow[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [mesaId, setMesaId] = useState("");
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [qr, setQr] = useState<{ pareamento: Pareamento; titulo: string } | null>(null);

  const carregar = useCallback(() => {
    Promise.all([source.dispositivos(loja.store_id), source.mesas(loja.store_id)])
      .then(([d, m]) => {
        setDispositivos(d);
        setMesas(m.filter((x) => x.is_active));
      })
      .catch((e: unknown) => setErro(mensagemDe(e)));
  }, [source, loja.store_id]);

  useEffect(carregar, [carregar]);

  const mesaEscolhida = useMemo(() => mesas.find((m) => m.id === mesaId) ?? null, [mesas, mesaId]);
  const ativoNaMesa = useMemo(
    () => (dispositivos ?? []).find((d) => d.table_id === mesaId && d.status === "active") ?? null,
    [dispositivos, mesaId],
  );

  async function provisionar() {
    if (!mesaEscolhida) return;
    setEnviando(true);
    setAviso(null);
    try {
      const p = await source.provisionar({
        store_id: loja.store_id,
        table_id: mesaEscolhida.id,
        name: nome.trim() || `Tablet Mesa ${mesaEscolhida.number}`,
      });
      setQr({ pareamento: p, titulo: `Mesa ${mesaEscolhida.number}` });
      setFormAberto(false);
      setMesaId("");
      setNome("");
      carregar();
    } catch (e: unknown) {
      setAviso(mensagemDe(e));
    } finally {
      setEnviando(false);
    }
  }

  async function alterar(d: DeviceRow, corpo: Parameters<typeof source.alterarDispositivo>[1]) {
    if (corpo.acao === "estado" && corpo.status === "retired") {
      const certeza = window.confirm(`Aposentar "${d.name}"? O token dele para de funcionar e não volta.`);
      if (!certeza) return;
    }
    setAviso(null);
    try {
      const p = await source.alterarDispositivo(d.id, corpo);
      if (p) setQr({ pareamento: p, titulo: d.table_number ? `Mesa ${d.table_number}` : d.name });
      carregar();
    } catch (e: unknown) {
      setAviso(mensagemDe(e));
    }
  }

  return (
    <>
      <PageHeader
        titulo="Dispositivos"
        descricao="Os tablets da casa, um por mesa. Pareamento, estado, versão, bateria e último contato."
        acao={
          gestor ? (
            <Button onClick={() => setFormAberto((v) => !v)}>Provisionar dispositivo</Button>
          ) : undefined
        }
      />

      {aviso ? (
        <div className="mb-4">
          <Hint>{aviso}</Hint>
        </div>
      ) : null}

      {qr ? (
        <Panel
          titulo={`QR de configuração · ${qr.titulo}`}
          descricao={`Leia com a câmera do tablet. Vale até ${horaCurta(qr.pareamento.expiraEm)} e uma única leitura.`}
        >
          <div className="flex flex-wrap items-center gap-8">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL gerada no servidor */}
            <img src={qr.pareamento.qr} alt="QR de configuração do tablet" width={280} height={280} className="rounded-input border-line border-2" />
            <div className="max-w-md space-y-3">
              <Hint>
                Este QR aparece só agora. Fechando o painel, ele não volta: se o tablet não parear a
                tempo, use &ldquo;Novo código&rdquo; na lista. O token do tablet nunca passa por esta tela.
              </Hint>
              <Button variante="secundario" onClick={() => setQr(null)}>
                Fechar e esquecer o código
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {formAberto ? (
        <Panel titulo="Provisionar um tablet" descricao="Um dispositivo ativo por mesa, garantido pelo banco.">
          <div className="grid gap-4 min-[1100px]:grid-cols-2">
            <Field rotulo="Mesa">
              <select
                value={mesaId}
                onChange={(e) => setMesaId(e.target.value)}
                className="rounded-input border-line bg-canvas jm-touch jm-focus w-full border-2 px-4 text-base"
              >
                <option value="">Escolha a mesa</option>
                {mesas.map((m) => (
                  <option key={m.id} value={m.id}>
                    Mesa {m.number}
                    {m.label ? ` · ${m.label}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field rotulo="Nome do aparelho" ajuda="Opcional. Sem nome, fica Tablet Mesa N.">
              <TextInput value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} />
            </Field>
          </div>
          {ativoNaMesa ? (
            <div className="mt-2">
              <Hint>
                A mesa {mesaEscolhida?.number} já tem &ldquo;{ativoNaMesa.name}&rdquo; ativo. Provisionar
                aposenta esse aparelho, e o token dele para de funcionar.
              </Hint>
            </div>
          ) : null}
          <div className="mt-4 flex gap-3">
            <Button onClick={provisionar} disabled={!mesaEscolhida || enviando}>
              {enviando ? "Gerando…" : "Gerar QR de configuração"}
            </Button>
            <Button variante="secundario" onClick={() => setFormAberto(false)}>
              Cancelar
            </Button>
          </div>
        </Panel>
      ) : null}

      <Panel titulo={dispositivos ? `${dispositivos.length} dispositivo(s)` : "Dispositivos"}>
        {erro ? (
          <Hint>{erro}</Hint>
        ) : !dispositivos ? (
          <p className="text-muted">Carregando…</p>
        ) : (
          <Table colunas={["Aparelho", "Mesa", "Pareamento", "Bateria", "Último contato", "Estado", ""]}>
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
                  <Cell>{pareamento(d)}</Cell>
                  <Cell>
                    {d.battery_level === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className={bateriaBaixa ? "text-danger font-bold" : ""}>{d.battery_level}%</span>
                    )}
                  </Cell>
                  <Cell>
                    <span className={c.alerta && d.status === "active" && d.is_paired ? "text-danger font-semibold" : ""}>
                      {c.texto}
                    </span>
                  </Cell>
                  <Cell>{estado(d)}</Cell>
                  <Cell alinhar="right">
                    {gestor && d.status !== "retired" ? (
                      <div className="flex justify-end gap-2">
                        {d.status === "active" && !d.is_paired ? (
                          <Button variante="secundario" onClick={() => alterar(d, { acao: "novo_codigo" })}>
                            Novo código
                          </Button>
                        ) : null}
                        {d.status === "active" ? (
                          <Button variante="secundario" onClick={() => alterar(d, { acao: "estado", status: "inactive" })}>
                            Desativar
                          </Button>
                        ) : (
                          <Button variante="secundario" onClick={() => alterar(d, { acao: "estado", status: "active" })}>
                            Reativar
                          </Button>
                        )}
                        <Button variante="secundario" onClick={() => alterar(d, { acao: "estado", status: "retired" })}>
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
