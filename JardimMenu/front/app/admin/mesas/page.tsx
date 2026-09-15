"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeviceRow, TableRow as Mesa } from "@/lib/types";
import { mensagemDe } from "@/lib/admin-source";
import { useAdmin } from "@/components/admin/AdminContext";
import { Badge, Button, Cell, Field, Hint, PageHeader, Panel, Row, Switch, Table, TextInput } from "@/components/admin/ui";

/**
 * Mesas (JM-051). A mesa criada aqui pode receber um dispositivo (JM-180). Não há QR de
 * plaquinha: isso é do Módulo O, na Fase C (D21).
 *
 * Desligar o pedido de uma mesa (JM-186) é da Fase B, junto com a tela da equipe, e não
 * tem gravação nesta etapa: a tela mostra o estado e não oferece o interruptor.
 */
export default function AdminMesas() {
  const { source, loja, gestor } = useAdmin();
  const [mesas, setMesas] = useState<Mesa[] | null>(null);
  const [dispositivos, setDispositivos] = useState<DeviceRow[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nova, setNova] = useState({ number: "", label: "" });

  const carregar = useCallback(() => {
    Promise.all([source.mesas(loja.store_id), source.dispositivos(loja.store_id)])
      .then(([m, d]) => {
        setMesas(m);
        setDispositivos(d);
      })
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

  function salvar(m: Mesa, mudanca: Partial<Mesa>) {
    return executar(() =>
      source.rpc("admin_upsert_table", {
        p_store_id: loja.store_id,
        p_id: m.id,
        p_number: mudanca.number ?? m.number,
        p_label: mudanca.label === undefined ? m.label : mudanca.label,
        p_is_active: mudanca.is_active ?? m.is_active,
      }),
    );
  }

  async function criar() {
    const numero = Math.floor(Number(nova.number));
    if (!Number.isFinite(numero) || numero < 1) {
      setAviso("O número da mesa é obrigatório e começa em 1.");
      return;
    }
    const ok = await executar(
      () =>
        source.rpc("admin_upsert_table", {
          p_store_id: loja.store_id,
          p_id: null,
          p_number: numero,
          p_label: nova.label.trim() || null,
          p_is_active: true,
        }),
      `Mesa ${numero} criada. Provisione o tablet dela em Dispositivos.`,
    );
    if (ok) setNova({ number: "", label: "" });
  }

  const tabletDa = (mesaId: string) => dispositivos.find((d) => d.table_id === mesaId && d.status === "active") ?? null;

  return (
    <>
      <PageHeader titulo="Mesas" descricao="Uma mesa por tablet. A mesa criada aqui recebe o dispositivo em Dispositivos." />

      {aviso ? (
        <div className="mb-4">
          <Hint>{aviso}</Hint>
        </div>
      ) : null}

      {gestor ? (
        <Panel titulo="Nova mesa">
          <div className="grid gap-4 min-[1100px]:grid-cols-[1fr_2fr_auto] min-[1100px]:items-end">
            <Field rotulo="Número">
              <TextInput inputMode="numeric" value={nova.number} onChange={(e) => setNova({ ...nova, number: e.target.value })} />
            </Field>
            <Field rotulo="Etiqueta" ajuda="Opcional, como Varanda 3.">
              <TextInput value={nova.label} maxLength={40} onChange={(e) => setNova({ ...nova, label: e.target.value })} />
            </Field>
            <div className="mb-6">
              <Button onClick={criar} disabled={!nova.number.trim()}>
                Criar mesa
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      <Hint>
        Desligar o pedido de uma mesa (contingência, JM-186) entra na Fase B, com a tela da equipe. Até lá, todo
        tablet pareado e ativo mostra o cardápio normalmente.
      </Hint>

      <div className="h-4" />

      <Panel titulo={mesas ? `${mesas.length} mesa(s)` : "Mesas"}>
        {erro ? (
          <Hint>{erro}</Hint>
        ) : !mesas ? (
          <p className="text-muted">Carregando…</p>
        ) : (
          <Table colunas={["Mesa", "Etiqueta", "Tablet", "Pedido pelo tablet", "Ativa"]}>
            {mesas.map((m) => {
              const tablet = tabletDa(m.id);
              return (
                <Row key={m.id}>
                  <Cell>
                    <span className="text-lg font-bold tabular-nums">{m.number}</span>
                  </Cell>
                  <Cell>
                    <TextInput
                      defaultValue={m.label ?? ""}
                      maxLength={40}
                      disabled={!gestor}
                      placeholder="—"
                      aria-label={`Etiqueta da mesa ${m.number}`}
                      onBlur={(e) => {
                        const etiqueta = e.target.value.trim() || null;
                        if (etiqueta !== m.label) void salvar(m, { label: etiqueta });
                      }}
                    />
                  </Cell>
                  <Cell>
                    {tablet ? (
                      <Badge tom={tablet.is_paired ? "ok" : "alerta"}>{tablet.is_paired ? tablet.name : "Aguardando pareamento"}</Badge>
                    ) : (
                      <span className="text-muted">sem tablet</span>
                    )}
                  </Cell>
                  <Cell>{m.ordering_enabled ? <Badge tom="ok">Pedindo</Badge> : <Badge tom="alerta">Desligado</Badge>}</Cell>
                  <Cell alinhar="right">
                    <Switch
                      ligado={m.is_active}
                      onChange={(v) => gestor && void salvar(m, { is_active: v })}
                      rotulo={`Mesa ${m.number} ativa`}
                    />
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
