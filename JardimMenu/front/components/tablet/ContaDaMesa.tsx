"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CancelamentoNoResumo, ComandaAberta, ComandaNoResumo, ModoDeComanda, ResumoDaMesa } from "@/lib/mesa";
import type { Uuid } from "@/lib/types";
import { money } from "@/lib/money";
import { PedidoRecusado } from "@/lib/sacola";
import { BotaoGarcom } from "./Garcom";

/**
 * "Minha comanda" e "Conta da mesa" (JM-011, JM-203), e o pedido de cancelamento pelo
 * cliente (JM-111).
 *
 * - Mostra só o que foi pedido pelo tablet, com o aviso "valor final confirmado no caixa"
 *   (D29). Os subtotais e o total vêm somados do servidor: o tablet não soma nada aqui.
 * - Item cancelado ou removido pela equipe, e comanda migrada, saem no próximo polling.
 * - Em `mesa_unica` as duas visões coincidem, e a tela mostra uma só (JM-011).
 * - O único botão que escreve é o de pedir cancelamento, e o que ele cria é uma
 *   solicitação: quem cancela é a equipe (§5.9, D28).
 */

type Visao = "minha" | "mesa";

interface Confirmando {
  orderId: Uuid;
  itemId: Uuid | null;
  rotulo: string;
}

export function ContaDaMesa({
  resumo,
  modo,
  ativa,
  fuso,
  semConexao,
  onPedirCancelamento,
  onEscolherComanda,
  onFechar,
}: {
  resumo: ResumoDaMesa | null;
  modo: ModoDeComanda;
  ativa: ComandaAberta | null;
  /** Fuso da loja, só para exibir a hora do pedido. */
  fuso: string;
  semConexao: boolean;
  onPedirCancelamento: (orderId: Uuid, itemId: Uuid | null) => Promise<void>;
  onEscolherComanda: () => void;
  onFechar: () => void;
}) {
  const [visao, setVisao] = useState<Visao>(modo === "nomeada" ? "minha" : "mesa");
  const [confirmando, setConfirmando] = useState<Confirmando | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fechar = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    fechar.current?.focus();
  }, []);

  useEffect(() => {
    const fechaComEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmando) setConfirmando(null);
      else onFechar();
    };
    window.addEventListener("keydown", fechaComEsc);
    return () => window.removeEventListener("keydown", fechaComEsc);
  }, [onFechar, confirmando]);

  const hora = useMemo(
    () => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: fuso }),
    [fuso],
  );

  const minha = ativa ? resumo?.tabs.find((t) => t.id === ativa.id) ?? null : null;
  const cancelamentos = resumo?.cancel_requests ?? [];
  const aprovados = cancelamentos.filter((c) => c.status === "approved").length;

  async function pedir() {
    if (!confirmando || pedindo) return;
    setPedindo(true);
    setErro(null);
    try {
      await onPedirCancelamento(confirmando.orderId, confirmando.itemId);
      setConfirmando(null);
    } catch (e) {
      setErro(e instanceof PedidoRecusado ? e.message : "O pedido de cancelamento não saiu. Chame o garçom.");
    } finally {
      setPedindo(false);
    }
  }

  const titulo = modo === "nomeada" ? (visao === "minha" ? "Minha comanda" : "Conta da mesa") : "Conta da mesa";

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conta-titulo"
      onClick={onFechar}
    >
      <div className="bg-surface shadow-float relative flex h-full w-full flex-col sm:w-[480px]" onClick={(e) => e.stopPropagation()}>
        <header className="border-line border-b px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="conta-titulo" className="text-2xl font-bold">
                {titulo}
              </h2>
              {resumo?.table_number != null ? <p className="text-muted text-sm">Mesa {resumo.table_number}</p> : null}
            </div>
            <BotaoGarcom compacto />
            <button
              ref={fechar}
              type="button"
              onClick={onFechar}
              aria-label="Fechar a conta"
              className="jm-touch jm-focus bg-canvas flex shrink-0 items-center justify-center rounded-full px-4 text-xl"
            >
              ✕
            </button>
          </div>

          {modo === "nomeada" ? (
            <div className="bg-canvas mt-4 grid grid-cols-2 gap-1 rounded-full p-1" role="tablist" aria-label="Visão da conta">
              {(["minha", "mesa"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={visao === v}
                  onClick={() => setVisao(v)}
                  className={`jm-touch jm-focus rounded-full px-3 text-base font-semibold ${
                    visao === v ? "bg-surface shadow-card" : "text-muted"
                  }`}
                >
                  {v === "minha" ? "Minha comanda" : "Conta da mesa"}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {semConexao ? (
            <p className="bg-danger rounded-input mb-4 p-3 text-base font-semibold text-white" role="status">
              Sem conexão: a conta pode estar desatualizada.
            </p>
          ) : null}
          {aprovados > 0 ? (
            <p className="bg-canvas rounded-input mb-4 p-3 text-base" role="status">
              A equipe aprovou {aprovados === 1 ? "um cancelamento" : `${aprovados} cancelamentos`}, e o valor saiu da conta.
            </p>
          ) : null}

          {!resumo ? (
            <p className="text-muted py-10 text-center text-base">Carregando a conta…</p>
          ) : modo === "nomeada" && visao === "mesa" ? (
            <ListaDeComandas comandas={resumo.tabs} ativa={ativa} />
          ) : modo === "nomeada" && !minha ? (
            <div className="py-10 text-center">
              <p className="text-lg font-semibold">{ativa ? "Nenhum pedido nesta comanda ainda." : "Nenhuma comanda escolhida."}</p>
              {!ativa ? (
                <button
                  type="button"
                  onClick={onEscolherComanda}
                  className="jm-touch jm-focus bg-primary mt-4 rounded-full px-6 text-base font-semibold text-white"
                >
                  Escolher comanda
                </button>
              ) : null}
            </div>
          ) : (
            <ListaDePedidos
              comanda={modo === "nomeada" ? minha : (resumo.tabs[0] ?? null)}
              todas={modo === "mesa_unica" ? resumo.tabs : null}
              cancelamentos={cancelamentos}
              hora={hora}
              onPedir={(c) => {
                setErro(null);
                setConfirmando(c);
              }}
            />
          )}
        </div>

        <footer className="border-line bg-canvas border-t px-4 py-4 sm:px-6">
          {resumo ? (
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-lg font-semibold">
                {modo === "nomeada" && visao === "minha" ? "Subtotal da comanda" : "Total da mesa"}
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {money(modo === "nomeada" && visao === "minha" ? (minha?.subtotal ?? 0) : resumo.total)}
              </span>
            </div>
          ) : null}
          <p className="text-muted mt-1 text-sm">Valor final confirmado no caixa.</p>
        </footer>

        {confirmando ? (
          <div className="absolute inset-0 flex items-end justify-center bg-black/45 p-4 sm:items-center" role="alertdialog" aria-labelledby="cancelar-titulo">
            <div className="rounded-modal bg-surface shadow-float w-full max-w-sm p-5">
              <p id="cancelar-titulo" className="text-xl font-bold">
                Pedir o cancelamento?
              </p>
              <p className="mt-2 text-base">{confirmando.rotulo}</p>
              <p className="text-muted mt-2 text-sm">A equipe recebe o pedido e decide. Se o prato já saiu, ela avisa.</p>
              {erro ? (
                <p className="mt-3 text-base font-semibold" role="alert">
                  {erro}
                </p>
              ) : null}
              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setConfirmando(null)}
                  disabled={pedindo}
                  className="jm-touch jm-focus bg-surface border-line rounded-full border-2 px-5 text-base font-semibold"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={pedir}
                  disabled={pedindo}
                  className="jm-touch jm-focus bg-primary rounded-full px-5 text-base font-bold text-white disabled:opacity-45 sm:flex-1"
                >
                  {pedindo ? "Enviando…" : "Pedir cancelamento"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** "Conta da mesa" no modo nomeada: uma linha por comanda, com o subtotal do servidor. */
function ListaDeComandas({ comandas, ativa }: { comandas: ComandaNoResumo[]; ativa: ComandaAberta | null }) {
  if (comandas.length === 0) return <p className="text-muted py-10 text-center text-base">Nenhuma comanda aberta.</p>;
  return (
    <ul>
      {comandas.map((c) => (
        <li key={c.id} className="border-line flex items-baseline justify-between gap-4 border-b py-4 last:border-b-0">
          <span className="min-w-0 truncate text-lg font-semibold">
            {c.name}
            {ativa?.id === c.id ? <span className="text-muted ml-2 text-sm font-normal">(atual)</span> : null}
          </span>
          <span className="text-lg font-bold tabular-nums">{money(c.subtotal)}</span>
        </li>
      ))}
    </ul>
  );
}

function situacao(cancelamentos: CancelamentoNoResumo[], orderId: Uuid, itemId: Uuid | null) {
  const doAlvo = cancelamentos.filter((c) => c.order_id === orderId && c.item_id === itemId);
  if (doAlvo.some((c) => c.status === "pending")) return "pendente" as const;
  if (doAlvo.some((c) => c.status === "rejected")) return "recusado" as const;
  return null;
}

function ListaDePedidos({
  comanda,
  todas,
  cancelamentos,
  hora,
  onPedir,
}: {
  comanda: ComandaNoResumo | null;
  /** No modo mesa_unica, a conta inteira; normalmente uma comanda só, a "Mesa". */
  todas: ComandaNoResumo[] | null;
  cancelamentos: CancelamentoNoResumo[];
  hora: Intl.DateTimeFormat;
  onPedir: (c: Confirmando) => void;
}) {
  const pedidos = (todas ?? (comanda ? [comanda] : [])).flatMap((c) => c.orders);
  if (pedidos.length === 0) return <p className="text-muted py-10 text-center text-base">Nenhum pedido ainda.</p>;

  return (
    <ol className="grid gap-4">
      {pedidos.map((pedido) => {
        const doPedido = situacao(cancelamentos, pedido.id, null);
        return (
          <li key={pedido.id} className="rounded-card border-line border-2 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-lg font-bold">Pedido nº {pedido.display_number}</p>
              <p className="text-muted text-sm tabular-nums">{hora.format(new Date(pedido.created_at))}</p>
            </div>
            {doPedido === "pendente" ? (
              <p className="bg-canvas rounded-input mt-2 px-3 py-2 text-sm font-semibold">Cancelamento pedido, aguardando a equipe.</p>
            ) : doPedido === "recusado" ? (
              <p className="bg-canvas rounded-input mt-2 px-3 py-2 text-sm font-semibold">A equipe não aprovou o cancelamento deste pedido.</p>
            ) : null}

            <ul className="mt-2">
              {pedido.items.map((item) => {
                const doItem = situacao(cancelamentos, pedido.id, item.id);
                return (
                  <li key={item.id} className="border-line border-t py-3 first:border-t-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-semibold">
                          {item.quantity}× {item.name}
                        </p>
                        {item.options.length > 0 ? <p className="text-muted text-sm">{item.options.join(" · ")}</p> : null}
                        {item.notes ? <p className="text-muted text-sm italic">“{item.notes}”</p> : null}
                      </div>
                      <p className="text-base font-bold whitespace-nowrap tabular-nums">{money(item.line_total)}</p>
                    </div>
                    {doItem === "pendente" ? (
                      <p className="text-muted mt-1 text-sm font-semibold">Cancelamento pedido, aguardando a equipe.</p>
                    ) : doItem === "recusado" ? (
                      <p className="text-muted mt-1 text-sm font-semibold">A equipe não aprovou o cancelamento.</p>
                    ) : null}
                    {doPedido !== "pendente" && doItem !== "pendente" ? (
                      <button
                        type="button"
                        onClick={() =>
                          onPedir({ orderId: pedido.id, itemId: item.id, rotulo: `${item.quantity}× ${item.name}, do pedido nº ${pedido.display_number}.` })
                        }
                        className="jm-touch jm-focus text-muted mt-1 rounded-full text-sm font-semibold underline"
                      >
                        Pedir cancelamento deste item
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {pedido.items.length > 1 && doPedido !== "pendente" ? (
              <button
                type="button"
                onClick={() => onPedir({ orderId: pedido.id, itemId: null, rotulo: `O pedido nº ${pedido.display_number} inteiro.` })}
                className="jm-touch jm-focus bg-surface border-line mt-2 w-full rounded-full border-2 px-4 text-base font-semibold"
              >
                Pedir cancelamento do pedido inteiro
              </button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
