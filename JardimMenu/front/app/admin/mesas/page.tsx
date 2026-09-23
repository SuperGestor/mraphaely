"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeviceRow, TabMode, TableRow as Mesa } from "@/lib/types";
import { mensagemDe } from "@/lib/admin-source";
import {
  MAXIMO_DE_MESA_PARADA,
  MINIMO_DE_MESA_PARADA,
  lerMinutosDeMesaParada,
  rotuloDeDuracao,
} from "@/lib/mesa-parada";
import { useAdmin } from "@/components/admin/AdminContext";
import { Badge, Button, Cell, Field, Hint, PageHeader, Panel, Row, Switch, Table, TextInput } from "@/components/admin/ui";
import { DialogoDeConfirmacao, DialogoDeMotivo } from "@/components/equipe/Dialogos";

/**
 * Mesas (JM-051). A mesa criada aqui pode receber um dispositivo (JM-180). Não há QR de
 * plaquinha: isso é do Módulo O, na Fase C (D21).
 *
 * Fase B: o modo de comanda da loja (JM-200), o tempo de mesa parada (JM-122) e a
 * contingência por mesa (JM-186), os três só do dono e do gestor. A contingência também
 * está na tela da equipe, onde ela é usada no turno; aqui ela aparece junto do cadastro da
 * mesa.
 */
export default function AdminMesas() {
  const { source, loja, gestor } = useAdmin();
  const [mesas, setMesas] = useState<Mesa[] | null>(null);
  const [dispositivos, setDispositivos] = useState<DeviceRow[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nova, setNova] = useState({ number: "", label: "" });
  const [modo, setModo] = useState<TabMode | null>(null);
  const [pausando, setPausando] = useState<Mesa | null>(null);
  const [retomando, setRetomando] = useState<Mesa | null>(null);
  /** Mesa parada (JM-122): o valor gravado e o que está sendo digitado, separados. */
  const [paradaGravada, setParadaGravada] = useState<number | null>(null);
  const [parada, setParada] = useState("");
  const [problemaDaParada, setProblemaDaParada] = useState<string | null>(null);

  const carregar = useCallback(() => {
    Promise.all([source.mesas(loja.store_id), source.dispositivos(loja.store_id), source.loja(loja.store_id)])
      .then(([m, d, l]) => {
        setMesas(m);
        setDispositivos(d);
        setModo(l.tab_mode);
        setParadaGravada(l.idle_table_alert_minutes);
        setParada(String(l.idle_table_alert_minutes));
        setProblemaDaParada(null);
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

  function trocarModo(novo: TabMode) {
    if (novo === modo) return;
    void executar(
      () => source.rpc("admin_set_tab_mode", { p_store_id: loja.store_id, p_mode: novo }),
      novo === "nomeada"
        ? "Comanda com nome ligada. Vale para as próximas mesas abertas."
        : "Comanda única ligada. Vale para as próximas mesas abertas.",
    );
  }

  /**
   * Mesa parada (JM-122, P5). A faixa é conferida aqui só para não ir ao servidor com
   * número impossível; quem recusa de verdade é a function, e depois dela o CHECK da
   * tabela.
   */
  function salvarMesaParada() {
    const leitura = lerMinutosDeMesaParada(parada);
    if (!leitura.ok) {
      setProblemaDaParada(leitura.problema);
      return;
    }
    setProblemaDaParada(null);
    void executar(
      () => source.rpc("admin_update_store_idle_alert", { p_store_id: loja.store_id, p_minutes: leitura.minutos }),
      `Mesa parada: a equipe passa a ser avisada depois de ${rotuloDeDuracao(leitura.minutos)} sem pedido.`,
    );
  }

  /** Contingência (JM-186): lança a recusa do banco para o diálogo mostrar. */
  async function contingencia(m: Mesa, pedindo: boolean, motivo: string | null) {
    await source.rpc("staff_set_table_ordering", { p_table_id: m.id, p_enabled: pedindo, p_reason: motivo });
    setAviso(pedindo ? `Mesa ${m.number} voltou a pedir pelo tablet.` : `Pedido da mesa ${m.number} pausado.`);
    carregar();
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

      <Panel
        titulo="Comandas"
        descricao="Como a conta se divide na mesa. A troca vale para as próximas mesas abertas; a mesa que já está aberta segue no modo em que abriu."
      >
        {modo === null ? (
          <p className="text-muted">Carregando…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Modo de comanda">
            {(
              [
                ["mesa_unica", "Uma conta por mesa", "O cliente nunca vê a palavra comanda. É o padrão."],
                ["nomeada", "Comanda com nome", "Cada pessoa abre a sua comanda no tablet, e a conta sai separada."],
              ] as const
            ).map(([valor, titulo, texto]) => (
              <button
                key={valor}
                type="button"
                role="radio"
                aria-checked={modo === valor}
                disabled={!gestor}
                onClick={() => trocarModo(valor)}
                className={`jm-focus rounded-input border-2 p-4 text-left disabled:opacity-60 ${
                  modo === valor ? "border-primary bg-canvas" : "border-line bg-surface"
                }`}
              >
                <span className="block text-base font-bold">{titulo}</span>
                <span className="text-muted mt-1 block text-sm">{texto}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        titulo="Mesa parada"
        descricao="Quanto tempo uma mesa aberta pode ficar sem pedido novo antes de a tela da equipe destacá-la."
      >
        {paradaGravada === null ? (
          <p className="text-muted">Carregando…</p>
        ) : (
          <>
            <p className="text-muted mb-4 text-sm">
              O destaque é só um aviso para a equipe: ele <strong className="text-ink">não encerra a mesa</strong>, não
              encerra comanda e não muda nada no tablet do cliente. Quem encerra continua sendo a equipe.
            </p>
            <div className="grid gap-4 min-[1100px]:grid-cols-[1fr_2fr_auto] min-[1100px]:items-end">
              <Field
                rotulo="Tempo sem pedido"
                ajuda={`Em minutos, de ${MINIMO_DE_MESA_PARADA} a ${MAXIMO_DE_MESA_PARADA}.`}
                erro={problemaDaParada}
              >
                <TextInput
                  inputMode="numeric"
                  value={parada}
                  disabled={!gestor}
                  aria-label="Tempo de mesa parada, em minutos"
                  onChange={(e) => {
                    setParada(e.target.value);
                    setProblemaDaParada(null);
                  }}
                />
              </Field>
              <div className="mb-6">
                <p className="text-base">
                  Hoje a equipe é avisada depois de{" "}
                  <strong className="tabular-nums">{rotuloDeDuracao(paradaGravada)}</strong> sem pedido.
                </p>
                <p className="text-muted mt-1 text-sm">Sem nenhum pedido ainda, a conta corre desde a abertura da mesa.</p>
              </div>
              {gestor ? (
                <div className="mb-6">
                  <Button onClick={salvarMesaParada} disabled={parada.trim() === String(paradaGravada)}>
                    Gravar tempo
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </Panel>

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
                      <Badge tom="ok">{tablet.name}</Badge>
                    ) : (
                      <span className="text-muted">sem tablet</span>
                    )}
                  </Cell>
                  <Cell>
                    <div className="flex flex-wrap items-center gap-2">
                      {m.ordering_enabled ? <Badge tom="ok">Pedindo</Badge> : <Badge tom="alerta">Pausado</Badge>}
                      {gestor ? (
                        <button
                          type="button"
                          onClick={() => (m.ordering_enabled ? setPausando(m) : setRetomando(m))}
                          className="jm-touch jm-focus text-muted text-sm font-semibold underline"
                        >
                          {m.ordering_enabled ? "Pausar" : "Retomar"}
                        </button>
                      ) : null}
                    </div>
                    {!m.ordering_enabled && m.ordering_disabled_reason ? (
                      <p className="text-muted mt-1 text-xs">{m.ordering_disabled_reason}</p>
                    ) : null}
                  </Cell>
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

      {pausando ? (
        <DialogoDeMotivo
          titulo={`Pausar o pedido da mesa ${pausando.number}?`}
          texto="O cardápio continua navegável, o tablet mostra “peça ao garçom”, e o chamado de garçom segue funcionando."
          rotulo="Pausar pedido"
          sugestoes={["Tablet com defeito", "Mesa reservada"]}
          onConfirmar={(motivo) => contingencia(pausando, false, motivo)}
          onFechar={() => setPausando(null)}
        />
      ) : null}
      {retomando ? (
        <DialogoDeConfirmacao
          titulo={`Retomar o pedido da mesa ${retomando.number}?`}
          texto="O tablet volta a enviar pedidos em até 10 s."
          rotulo="Retomar pedido"
          onConfirmar={() => contingencia(retomando, true, null)}
          onFechar={() => setRetomando(null)}
        />
      ) : null}
    </>
  );
}
