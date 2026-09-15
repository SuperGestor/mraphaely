"use client";

import { useEffect, useState } from "react";
import type { TimeWindow } from "@/lib/types";
import { mensagemDe } from "@/lib/admin-source";
import { useAdmin } from "@/components/admin/AdminContext";
import { Button, Cell, Field, Hint, PageHeader, Panel, Row, Switch, Table, TextInput } from "@/components/admin/ui";

/**
 * Horário de funcionamento (JM-005) e fuso da loja (D12). A tela **edita** a
 * configuração; quem decide se a loja está aberta agora é o banco, no fuso da loja
 * (regra 5). O front nunca faz aritmética de fuso.
 *
 * Dia ausente significa fechado, expediente que cruza a meia-noite é aceito (fim menor
 * que o início), e "sem restrição" grava horário nulo, que não bloqueia nada.
 */
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const FUSOS = [
  "America/Sao_Paulo",
  "America/Fortaleza",
  "America/Recife",
  "America/Belem",
  "America/Manaus",
  "America/Cuiaba",
  "America/Porto_Velho",
  "America/Rio_Branco",
  "America/Noronha",
];
const SELECT = "rounded-input border-line bg-canvas jm-touch jm-focus w-full border-2 px-4 text-base";

interface Estado {
  restrito: boolean;
  janelas: TimeWindow[];
  fuso: string;
  inicioDoDia: string;
}

export default function AdminHorario() {
  const { source, loja, gestor } = useAdmin();
  const [original, setOriginal] = useState<Estado | null>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    source
      .loja(loja.store_id)
      .then((l) => {
        const inicial: Estado = {
          restrito: l.opening_hours !== null,
          janelas: [...(l.opening_hours ?? [])].sort((a, b) => a.dow - b.dow),
          fuso: l.timezone,
          inicioDoDia: l.business_day_start.slice(0, 5),
        };
        setOriginal(inicial);
        setEstado(inicial);
      })
      .catch((e: unknown) => setAviso(mensagemDe(e)));
  }, [source, loja.store_id]);

  if (!estado || !original) {
    return (
      <>
        <PageHeader titulo="Horário" descricao="Quando a casa aceita pedido pelo tablet." />
        {aviso ? <Hint>{aviso}</Hint> : <p className="text-muted">Carregando…</p>}
      </>
    );
  }

  const atual = estado;
  const sujo = JSON.stringify(atual) !== JSON.stringify(original);
  const doDia = (dow: number) => atual.janelas.find((j) => j.dow === dow) ?? null;

  function alternarDia(dow: number, aberto: boolean) {
    setEstado({
      ...atual,
      janelas: aberto
        ? [...atual.janelas, { dow, open: "18:00", close: "23:00" }].sort((a, b) => a.dow - b.dow)
        : atual.janelas.filter((j) => j.dow !== dow),
    });
  }

  function mudarHora(dow: number, campo: "open" | "close", valor: string) {
    setEstado({ ...atual, janelas: atual.janelas.map((j) => (j.dow === dow ? { ...j, [campo]: valor } : j)) });
  }

  async function salvar() {
    setSalvando(true);
    setAviso(null);
    try {
      await source.rpc("admin_update_store_hours", {
        p_store_id: loja.store_id,
        p_opening_hours: atual.restrito ? atual.janelas : null,
        p_timezone: atual.fuso,
        p_business_day_start: atual.inicioDoDia,
      });
      setOriginal(atual);
      setAviso("Horário gravado. O tablet passa a seguir o novo horário na próxima consulta.");
    } catch (e: unknown) {
      setAviso(mensagemDe(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Horário"
        descricao="Quando a casa aceita pedido pelo tablet. Fora do horário o cardápio continua navegável."
        acao={
          gestor ? (
            <Button onClick={salvar} disabled={!sujo || salvando}>
              {salvando ? "Gravando…" : "Gravar horário"}
            </Button>
          ) : undefined
        }
      />

      {aviso ? (
        <div className="mb-4">
          <Hint>{aviso}</Hint>
        </div>
      ) : null}

      <Panel titulo="Fuso e turno" descricao="O dia operacional vai do início daqui até um minuto antes, no dia seguinte (JM-053).">
        <div className="grid gap-4 min-[1100px]:grid-cols-2">
          <Field rotulo="Fuso da loja">
            <select className={SELECT} value={atual.fuso} disabled={!gestor} onChange={(e) => setEstado({ ...atual, fuso: e.target.value })}>
              {FUSOS.map((f) => (
                <option key={f} value={f}>
                  {f.replace("America/", "").replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field rotulo="Início do dia operacional">
            <TextInput
              type="time"
              value={atual.inicioDoDia}
              disabled={!gestor}
              onChange={(e) => setEstado({ ...atual, inicioDoDia: e.target.value })}
              className="max-w-36"
            />
          </Field>
        </div>
      </Panel>

      <Panel
        titulo="Dias da semana"
        descricao="Expediente que cruza a meia-noite é aceito: basta o fim ser menor que o início, como sexta das 18:00 às 02:00."
      >
        <div className="mb-4 flex items-center gap-3">
          <Switch
            ligado={atual.restrito}
            onChange={(v) => gestor && setEstado({ ...atual, restrito: v })}
            rotulo="Loja com horário de funcionamento"
          />
          <span className="text-base">
            {atual.restrito ? "A loja segue o horário abaixo" : "Sem restrição de horário: o pedido nunca é bloqueado por horário"}
          </span>
        </div>

        {atual.restrito ? (
          <Table colunas={["Dia", "Abre o dia", "Abertura", "Fechamento", "Observação"]}>
            {DIAS.map((nome, dow) => {
              const janela = doDia(dow);
              const cruza = janela !== null && janela.close < janela.open;
              return (
                <Row key={dow}>
                  <Cell>
                    <span className="font-semibold">{nome}</span>
                  </Cell>
                  <Cell>
                    <Switch ligado={janela !== null} onChange={(v) => gestor && alternarDia(dow, v)} rotulo={`Abrir na ${nome}`} />
                  </Cell>
                  <Cell>
                    {janela ? (
                      <TextInput
                        type="time"
                        value={janela.open}
                        disabled={!gestor}
                        onChange={(e) => mudarHora(dow, "open", e.target.value)}
                        aria-label={`Abertura de ${nome}`}
                        className="max-w-36"
                      />
                    ) : (
                      <span className="text-muted">fechado</span>
                    )}
                  </Cell>
                  <Cell>
                    {janela ? (
                      <TextInput
                        type="time"
                        value={janela.close}
                        disabled={!gestor}
                        onChange={(e) => mudarHora(dow, "close", e.target.value)}
                        aria-label={`Fechamento de ${nome}`}
                        className="max-w-36"
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Cell>
                  <Cell>
                    <span className="text-muted text-sm">{cruza ? "fecha no dia seguinte" : "—"}</span>
                  </Cell>
                </Row>
              );
            })}
          </Table>
        ) : null}
      </Panel>
    </>
  );
}
