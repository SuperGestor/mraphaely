"use client";

import { useEffect, useState } from "react";
import type { DeviceRow, TableRow } from "@/lib/types";
import { mensagemDe, type CardapioAdmin } from "@/lib/admin-source";
import { useAdmin } from "@/components/admin/AdminContext";
import { Badge, Hint, PageHeader, Panel } from "@/components/admin/ui";

/** Resumo do painel: o que a casa precisa olhar antes de abrir. */
export default function AdminResumo() {
  const { source, loja } = useAdmin();
  const [cardapio, setCardapio] = useState<CardapioAdmin | null>(null);
  const [mesas, setMesas] = useState<TableRow[]>([]);
  const [dispositivos, setDispositivos] = useState<DeviceRow[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([source.cardapio(loja.store_id), source.mesas(loja.store_id), source.dispositivos(loja.store_id)])
      .then(([c, m, d]) => {
        setCardapio(c);
        setMesas(m);
        setDispositivos(d);
      })
      .catch((e: unknown) => setErro(mensagemDe(e)));
  }, [source, loja.store_id]);

  const produtos = cardapio?.produtos.filter((p) => p.is_active) ?? [];
  const ativos = dispositivos.filter((d) => d.status === "active");
  const indisponiveis = produtos.filter((p) => !p.is_available).length;
  const semCodigoPdv = produtos.filter((p) => !p.pdv_code).length;
  const semFoto = produtos.filter((p) => !p.photo_path).length;
  const mesasSemTablet = mesas.filter((m) => m.is_active && !ativos.some((d) => d.table_id === m.id)).length;
  const aguardando = ativos.filter((d) => !d.is_paired).length;
  const bateriaBaixa = ativos.filter((d) => (d.battery_level ?? 100) < 20).length;
  const semContato = ativos.filter(
    (d) => d.is_paired && d.last_seen_at !== null && Date.now() - Date.parse(d.last_seen_at) > 5 * 60_000,
  ).length;

  const carregando = cardapio === null && !erro;
  const numeros: [string, string | number, "neutro" | "alerta" | "erro"][] = [
    ["Produtos no cardápio", carregando ? "…" : produtos.length, "neutro"],
    ["Esgotados hoje", indisponiveis, indisponiveis > 0 ? "alerta" : "neutro"],
    ["Sem código do PDV", semCodigoPdv, semCodigoPdv > 0 ? "alerta" : "neutro"],
    ["Sem foto", semFoto, "neutro"],
    ["Mesas sem tablet ativo", mesasSemTablet, mesasSemTablet > 0 ? "alerta" : "neutro"],
    ["Tablets aguardando pareamento", aguardando, aguardando > 0 ? "alerta" : "neutro"],
    ["Tablets sem contato há 5 min", semContato, semContato > 0 ? "erro" : "neutro"],
    ["Tablets com bateria baixa", bateriaBaixa, bateriaBaixa > 0 ? "erro" : "neutro"],
  ];

  return (
    <>
      <PageHeader
        titulo="Resumo"
        descricao="O que olhar antes de abrir a casa. Os números vêm do cardápio, das mesas e dos dispositivos."
      />

      {erro ? (
        <div className="mb-4">
          <Hint>{erro}</Hint>
        </div>
      ) : null}

      <Panel>
        <div className="grid grid-cols-2 gap-4 min-[1100px]:grid-cols-4">
          {numeros.map(([rotulo, valor, tom]) => (
            <div key={rotulo} className="rounded-input border-line border-2 p-4">
              <p className="text-muted text-sm">{rotulo}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{valor}</p>
              {tom !== "neutro" ? (
                <span className="mt-2 inline-block">
                  <Badge tom={tom}>{tom === "erro" ? "Ver agora" : "Conferir"}</Badge>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>

      <Panel titulo="O que ainda está em aberto">
        <div className="space-y-3">
          <Hint>
            Marca, nome e domínio do produto são provisórios (A1). Eles vivem só em <code>lib/brand.ts</code>, e o
            domínio precisa estar decidido antes de provisionar os tablets de produção.
          </Hint>
          <Hint>
            A integração com o PDV está em pausa (D24, A18). Enquanto isso, o pedido do tablet aparece na tela da
            equipe, na Fase B, e é lançado no PDV pela casa.
          </Hint>
        </div>
      </Panel>
    </>
  );
}
