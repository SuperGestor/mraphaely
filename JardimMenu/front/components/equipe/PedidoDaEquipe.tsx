"use client";

import { money } from "@/lib/money";
import { minutosEntre, rotuloDeTempo, type ItemNoSalao, type PedidoNoSalao } from "@/lib/salao";

/**
 * Um pedido como a equipe precisa ver para lançar no PDV (D24, JM-121): número, horário,
 * itens com o código do PDV, complementos (com código, quando houver) e observações.
 * Item removido e pedido cancelado continuam visíveis, riscados, com o motivo (JM-033).
 */
export function PedidoDaEquipe({
  pedido,
  agora,
  cabecalho,
  onCancelar,
  onRemover,
}: {
  pedido: PedidoNoSalao;
  agora: string;
  /** Texto antes do número (ex.: "Mesa 3 · Maria"), na lista de pedidos recentes. */
  cabecalho?: string;
  onCancelar?: () => void;
  onRemover?: (item: ItemNoSalao) => void;
}) {
  const cancelado = pedido.status === "cancelled";
  const ativos = pedido.items.filter((i) => !i.removed_at).length;

  return (
    <article className={`rounded-card border-line bg-surface border-2 p-3 sm:p-4 ${cancelado ? "opacity-60" : ""}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-base font-bold">
          {cabecalho ? `${cabecalho} · ` : ""}Pedido nº {pedido.display_number}
        </p>
        <p className="text-muted text-sm">{rotuloDeTempo(minutosEntre(pedido.created_at, agora))}</p>
      </header>
      {cancelado ? (
        <p className="text-danger mt-1 text-sm font-semibold">Cancelado{pedido.cancel_reason ? `: ${pedido.cancel_reason}` : ""}</p>
      ) : null}

      <ul className="mt-2">
        {pedido.items.map((i) => (
          <li key={i.id} className="border-line border-t py-2 first:border-t-0">
            <div className="flex items-start justify-between gap-3">
              <div className={`min-w-0 ${i.removed_at ? "line-through opacity-60" : ""}`}>
                <p className="text-base font-semibold">
                  {i.quantity}× {i.name}
                  {i.pdv_code ? <span className="bg-canvas ml-2 rounded px-1.5 py-0.5 font-mono text-xs">{i.pdv_code}</span> : null}
                </p>
                {i.options.length > 0 ? (
                  <p className="text-muted text-sm">
                    {i.options.map((o) => (o.pdv_code ? `${o.name} (${o.pdv_code})` : o.name)).join(" · ")}
                  </p>
                ) : null}
                {i.notes ? <p className="text-sm font-semibold">Obs.: {i.notes}</p> : null}
              </div>
              <p className="text-sm font-semibold whitespace-nowrap tabular-nums">{money(i.line_total)}</p>
            </div>
            {i.removed_at ? (
              <p className="text-danger text-sm">Removido{i.remove_reason ? `: ${i.remove_reason}` : ""}</p>
            ) : onRemover && !cancelado && ativos > 1 ? (
              <button type="button" onClick={() => onRemover(i)} className="jm-touch jm-focus text-muted text-sm font-semibold underline">
                Remover item
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <footer className="border-line mt-1 flex items-center justify-between gap-3 border-t pt-2">
        <span className="text-sm font-semibold tabular-nums">{cancelado ? "—" : money(pedido.subtotal)}</span>
        {onCancelar && !cancelado ? (
          <button
            type="button"
            onClick={onCancelar}
            className="jm-touch jm-focus border-line rounded-full border-2 px-4 text-sm font-semibold"
          >
            Cancelar pedido
          </button>
        ) : null}
      </footer>
    </article>
  );
}
