"use client";

import { useEffect, useRef, useState } from "react";
import type { AcaoDaEquipe } from "@/lib/equipe-source";
import { money } from "@/lib/money";
import {
  bateriaBaixa,
  ehGestor,
  mesaParada,
  minutosEntre,
  rotuloDeTempo,
  tabletSemContato,
  totalDaMesa,
  type ComandaNoSalao,
  type ItemNoSalao,
  type MesaNoSalao,
  type PedidoNoSalao,
  type Salao,
} from "@/lib/salao";
import { PedidoDaEquipe } from "./PedidoDaEquipe";
import { DialogoDeConfirmacao, DialogoDeMigracao, DialogoDeMotivo, DialogoDeNome } from "./Dialogos";

type Dialogo =
  | { tipo: "cancelar"; pedido: PedidoNoSalao }
  | { tipo: "remover"; item: ItemNoSalao; pedido: PedidoNoSalao }
  | { tipo: "encerrar"; comanda: ComandaNoSalao }
  | { tipo: "migrar"; comanda: ComandaNoSalao }
  | { tipo: "renomear"; comanda: ComandaNoSalao }
  | { tipo: "fechar" }
  | { tipo: "pausar" }
  | { tipo: "retomar" };

/**
 * Uma mesa aberta na tela da equipe: tablet (JM-184), contingência (JM-186), chamados,
 * comandas com os pedidos, e as ações sobre elas: cancelar pedido e remover item (JM-033),
 * encerrar (JM-208), migrar (JM-209) e renomear comanda, e fechar a mesa (JM-141).
 *
 * Os botões seguem o papel (garçom não pausa nem fecha mesa), mas quem decide é a function
 * do banco: um botão que sobrar aqui é recusado lá.
 */
export function DetalheDaMesa({
  mesa,
  salao,
  agora,
  executar,
  onFechar,
}: {
  mesa: MesaNoSalao;
  salao: Salao;
  agora: string;
  executar: (a: AcaoDaEquipe) => Promise<unknown>;
  onFechar: () => void;
}) {
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const fechar = useRef<HTMLButtonElement | null>(null);
  const gestor = ehGestor(salao.role);
  // Modo da abertura (JM-200). Comanda com nome migrada para mesa de comanda única
  // continua mostrando o nome, para a equipe não confundir as contas.
  const nomeada = mesa.session?.tab_mode === "nomeada" || (mesa.session?.tabs.some((t) => t.name !== "Mesa") ?? false);

  useEffect(() => {
    fechar.current?.focus();
  }, []);

  useEffect(() => {
    const fechaComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dialogo) onFechar();
    };
    window.addEventListener("keydown", fechaComEsc);
    return () => window.removeEventListener("keydown", fechaComEsc);
  }, [onFechar, dialogo]);

  const feito = async (a: AcaoDaEquipe) => {
    await executar(a);
  };

  const tablet = mesa.device;
  const parada = mesaParada(mesa, { ...salao, now: agora });

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mesa-titulo"
      onClick={onFechar}
    >
      <div className="bg-canvas shadow-float flex h-full w-full flex-col sm:w-[540px]" onClick={(e) => e.stopPropagation()}>
        <header className="border-line bg-surface flex items-center gap-3 border-b px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id="mesa-titulo" className="text-2xl font-bold">
              Mesa {mesa.number}
              {mesa.label ? <span className="text-muted ml-2 text-base font-normal">{mesa.label}</span> : null}
            </h2>
            <p className="text-muted text-sm">
              {mesa.session
                ? `Aberta ${rotuloDeTempo(minutosEntre(mesa.session.opened_at, agora))} · ${money(totalDaMesa(mesa))}`
                : "Livre"}
              {parada ? " · parada" : ""}
            </p>
          </div>
          <button
            ref={fechar}
            type="button"
            onClick={onFechar}
            aria-label="Fechar a mesa na tela"
            className="jm-touch jm-focus bg-canvas flex shrink-0 items-center justify-center rounded-full px-4 text-xl"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {/* Tablet da mesa (JM-184). */}
          <section className="rounded-card bg-surface p-3 text-sm sm:p-4">
            {tablet ? (
              <>
                <p className="font-semibold">
                  {tablet.name} · {tablet.status === "active" ? "ativo" : "desativado"}
                </p>
                <p className={tabletSemContato(mesa, { ...salao, now: agora }) ? "text-danger font-semibold" : "text-muted"}>
                  Último contato: {tablet.last_seen_at ? rotuloDeTempo(minutosEntre(tablet.last_seen_at, agora)) : "nunca"}
                  {tablet.battery_level != null ? (
                    <span className={bateriaBaixa(mesa) ? "text-danger font-semibold" : ""}> · bateria {tablet.battery_level}%</span>
                  ) : null}
                  {tablet.app_version ? ` · versão ${tablet.app_version}` : ""}
                </p>
              </>
            ) : (
              <p className="text-muted">Sem tablet pareado nesta mesa.</p>
            )}
          </section>

          {/* Contingência (JM-186): dono e gestor. */}
          <section className="rounded-card bg-surface flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
            <div className="min-w-0">
              <p className="text-base font-semibold">Pedido pelo tablet: {mesa.ordering_enabled ? "ligado" : "pausado"}</p>
              {!mesa.ordering_enabled && mesa.ordering_disabled_reason ? (
                <p className="text-muted text-sm">Motivo: {mesa.ordering_disabled_reason}</p>
              ) : null}
            </div>
            {gestor ? (
              <button
                type="button"
                onClick={() => setDialogo({ tipo: mesa.ordering_enabled ? "pausar" : "retomar" })}
                className="jm-touch jm-focus border-line rounded-full border-2 px-4 text-sm font-semibold"
              >
                {mesa.ordering_enabled ? "Pausar pedido" : "Retomar pedido"}
              </button>
            ) : null}
          </section>

          {mesa.calls.map((c) => (
            <section key={c.id} className="rounded-card bg-danger flex items-center justify-between gap-3 p-3 text-white sm:p-4">
              <p className="font-semibold">
                Chamando {rotuloDeTempo(minutosEntre(c.created_at, agora))}
                {c.reinforced_at ? " · reforçado" : ""}
              </p>
              <button
                type="button"
                onClick={() => void feito({ acao: "atender", corpo: { call_id: c.id } })}
                className="jm-touch jm-focus text-ink rounded-full bg-white px-5 text-base font-bold"
              >
                Atender
              </button>
            </section>
          ))}

          {!mesa.session ? (
            <p className="text-muted py-8 text-center text-base">Mesa livre. A abertura nasce no primeiro toque no tablet.</p>
          ) : (
            mesa.session.tabs.map((t) => (
              <section key={t.id} className="rounded-card bg-surface p-3 sm:p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h3 className="text-lg font-bold">{nomeada ? t.name : "Conta da mesa"}</h3>
                  <p className="text-base font-bold tabular-nums">{money(t.subtotal)}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDialogo({ tipo: "encerrar", comanda: t })}
                    className="jm-touch jm-focus bg-primary rounded-full px-4 text-sm font-bold text-white"
                  >
                    {nomeada ? "Encerrar comanda" : "Encerrar conta"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialogo({ tipo: "migrar", comanda: t })}
                    className="jm-touch jm-focus border-line rounded-full border-2 px-4 text-sm font-semibold"
                  >
                    Migrar de mesa
                  </button>
                  {nomeada ? (
                    <button
                      type="button"
                      onClick={() => setDialogo({ tipo: "renomear", comanda: t })}
                      className="jm-touch jm-focus border-line rounded-full border-2 px-4 text-sm font-semibold"
                    >
                      Renomear
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 space-y-3">
                  {t.orders.length === 0 ? <p className="text-muted text-sm">Nenhum pedido ainda.</p> : null}
                  {[...t.orders].reverse().map((o) => (
                    <PedidoDaEquipe
                      key={o.id}
                      pedido={o}
                      agora={agora}
                      onCancelar={() => setDialogo({ tipo: "cancelar", pedido: o })}
                      onRemover={(item) => setDialogo({ tipo: "remover", item, pedido: o })}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {mesa.session && gestor ? (
          <footer className="border-line bg-surface border-t px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setDialogo({ tipo: "fechar" })}
              className="jm-touch jm-focus border-danger text-danger w-full rounded-full border-2 px-4 text-base font-semibold"
            >
              Fechar a mesa com motivo
            </button>
          </footer>
        ) : null}
      </div>

      {dialogo?.tipo === "cancelar" ? (
        <DialogoDeMotivo
          titulo={`Cancelar o pedido nº ${dialogo.pedido.display_number}?`}
          texto="O pedido sai da conta do tablet em até 10 s. Se já foi lançado no PDV, cancele lá também."
          rotulo="Cancelar pedido"
          sugestoes={["Pedido errado", "Cliente desistiu", "Item em falta"]}
          onConfirmar={(motivo) => feito({ acao: "cancelar_pedido", corpo: { order_id: dialogo.pedido.id, motivo } })}
          onFechar={() => setDialogo(null)}
        />
      ) : dialogo?.tipo === "remover" ? (
        <DialogoDeMotivo
          titulo={`Remover ${dialogo.item.quantity}× ${dialogo.item.name}?`}
          texto={`Do pedido nº ${dialogo.pedido.display_number}. O total é recalculado no banco.`}
          rotulo="Remover item"
          sugestoes={["Item em falta", "Pedido errado", "Cliente desistiu"]}
          onConfirmar={(motivo) => feito({ acao: "remover_item", corpo: { item_id: dialogo.item.id, motivo } })}
          onFechar={() => setDialogo(null)}
        />
      ) : dialogo?.tipo === "encerrar" ? (
        <DialogoDeConfirmacao
          titulo={nomeada ? `Encerrar a comanda ${dialogo.comanda.name}?` : "Encerrar a conta da mesa?"}
          texto={
            <>
              <p>Use depois que a conta foi paga no caixa. Total pedido pelo tablet: {money(dialogo.comanda.subtotal)}.</p>
              {mesa.session?.tabs.length === 1 ? <p className="text-muted mt-2 text-sm">A mesa fica livre para o próximo cliente.</p> : null}
            </>
          }
          rotulo="Encerrar"
          onConfirmar={() => feito({ acao: "encerrar_comanda", corpo: { tab_id: dialogo.comanda.id } })}
          onFechar={() => setDialogo(null)}
        />
      ) : dialogo?.tipo === "migrar" ? (
        <DialogoDeMigracao
          comanda={nomeada ? dialogo.comanda.name : `da mesa ${mesa.number}`}
          opcoes={salao.tables
            .filter((m) => m.is_active && m.id !== mesa.id)
            .map((m) => ({ id: m.id, number: m.number, ocupada: m.session !== null }))}
          onConfirmar={(mesaId) => feito({ acao: "migrar_comanda", corpo: { tab_id: dialogo.comanda.id, mesa_id: mesaId } })}
          onFechar={() => setDialogo(null)}
        />
      ) : dialogo?.tipo === "renomear" ? (
        <DialogoDeNome
          titulo="Renomear a comanda"
          inicial={dialogo.comanda.name}
          onConfirmar={(nome) => feito({ acao: "renomear_comanda", corpo: { tab_id: dialogo.comanda.id, nome } })}
          onFechar={() => setDialogo(null)}
        />
      ) : dialogo?.tipo === "fechar" && mesa.session ? (
        <DialogoDeMotivo
          titulo={`Fechar a mesa ${mesa.number}?`}
          texto="Encerra todas as comandas abertas desta mesa. Use só quando a conta foi resolvida fora do tablet (JM-141)."
          rotulo="Fechar a mesa"
          sugestoes={["Conta paga no caixa", "Cliente foi embora"]}
          onConfirmar={(motivo) => feito({ acao: "fechar_mesa", corpo: { session_id: mesa.session!.id, motivo } })}
          onFechar={() => setDialogo(null)}
        />
      ) : dialogo?.tipo === "pausar" ? (
        <DialogoDeMotivo
          titulo={`Pausar o pedido da mesa ${mesa.number}?`}
          texto="O cardápio continua navegável, e o tablet mostra “peça ao garçom”. O chamado de garçom segue funcionando."
          rotulo="Pausar pedido"
          sugestoes={["Tablet com defeito", "Mesa reservada", "Cozinha sobrecarregada"]}
          onConfirmar={(motivo) => feito({ acao: "contingencia", corpo: { mesa_id: mesa.id, pedindo: false, motivo } })}
          onFechar={() => setDialogo(null)}
        />
      ) : dialogo?.tipo === "retomar" ? (
        <DialogoDeConfirmacao
          titulo={`Retomar o pedido da mesa ${mesa.number}?`}
          texto="O tablet volta a enviar pedidos no próximo polling, em até 10 s."
          rotulo="Retomar pedido"
          onConfirmar={() => feito({ acao: "contingencia", corpo: { mesa_id: mesa.id, pedindo: true, motivo: null } })}
          onFechar={() => setDialogo(null)}
        />
      ) : null}
    </div>
  );
}
