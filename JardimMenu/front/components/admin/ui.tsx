"use client";

import type { ReactNode } from "react";

/**
 * Peças padrão do painel de configuração. Toda tela do admin usa estas, e só estas:
 * cabeçalho de página, painel, tabela, campo, interruptor, aviso e barra de gravar.
 *
 * O padrão existe para que cadastrar cardápio, mesas, dispositivos e aparência tenham
 * a mesma forma, o mesmo lugar de erro e o mesmo lugar de gravar. O admin também abre no
 * celular (15/09/2026): abaixo de 640px as peças quebram linha e as tabelas rolam na
 * horizontal dentro do painel, mantendo o alvo de toque de 44px nos controles.
 */

export function PageHeader({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h1 className="text-xl font-bold sm:text-2xl">{titulo}</h1>
        {descricao ? <p className="text-muted mt-1 max-w-2xl text-base">{descricao}</p> : null}
      </div>
      {acao ? <div className="w-full sm:w-auto sm:shrink-0">{acao}</div> : null}
    </header>
  );
}

export function Panel({
  titulo,
  descricao,
  children,
  rodape,
}: {
  titulo?: string;
  descricao?: string;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface shadow-card mb-6 overflow-hidden">
      {titulo ? (
        <div className="border-line border-b px-4 py-4 sm:px-6">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          {descricao ? <p className="text-muted mt-1 text-sm">{descricao}</p> : null}
        </div>
      ) : null}
      <div className="p-4 sm:p-6">{children}</div>
      {rodape ? <div className="border-line bg-canvas border-t px-4 py-4 sm:px-6">{rodape}</div> : null}
    </section>
  );
}

export function Table({
  colunas,
  children,
}: {
  colunas: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-base">
        <thead>
          <tr className="text-muted border-line border-b text-sm uppercase tracking-wide">
            {colunas.map((c) => (
              <th key={c} className="px-3 py-2 font-semibold whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="border-line border-b last:border-0">{children}</tr>;
}

export function Cell({
  children,
  alinhar = "left",
}: {
  children: ReactNode;
  alinhar?: "left" | "right";
}) {
  return (
    <td className={`px-3 py-3 align-middle ${alinhar === "right" ? "text-right" : ""}`}>
      {children}
    </td>
  );
}

export function Field({
  rotulo,
  ajuda,
  erro,
  children,
}: {
  rotulo: string;
  ajuda?: string;
  erro?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="mb-5 block">
      <span className="text-base font-semibold">{rotulo}</span>
      {ajuda ? <span className="text-muted mt-1 block text-sm">{ajuda}</span> : null}
      <span className="mt-2 block">{children}</span>
      {erro ? (
        <span className="text-danger mt-2 block text-sm font-semibold" role="alert">
          {erro}
        </span>
      ) : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-input border-line bg-canvas jm-touch jm-focus w-full border-2 px-4 text-base ${props.className ?? ""}`}
    />
  );
}

export function Switch({
  ligado,
  onChange,
  rotulo,
}: {
  ligado: boolean;
  onChange: (v: boolean) => void;
  rotulo: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      onClick={() => onChange(!ligado)}
      className={`jm-focus jm-touch inline-flex items-center rounded-full px-1 transition-colors ${
        ligado ? "bg-primary" : "bg-line"
      }`}
      style={{ width: 72 }}
    >
      <span
        className="bg-surface block size-8 rounded-full shadow-card transition-transform"
        style={{ transform: ligado ? "translateX(32px)" : "translateX(0)" }}
      />
    </button>
  );
}

export function Badge({
  tom = "neutro",
  children,
}: {
  tom?: "neutro" | "ok" | "alerta" | "erro";
  children: ReactNode;
}) {
  const cores = {
    neutro: "bg-canvas text-muted",
    ok: "bg-success/15 text-ink",
    alerta: "bg-accent/20 text-ink",
    erro: "bg-danger/15 text-ink",
  } as const;
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${cores[tom]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  variante = "primario",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "primario" | "secundario" | "perigo";
}) {
  const estilos = {
    primario: "bg-primary text-white",
    secundario: "bg-canvas text-ink border-2 border-line",
    perigo: "bg-danger text-white",
  } as const;
  return (
    <button
      {...props}
      className={`jm-touch jm-focus rounded-full px-5 text-base font-semibold disabled:opacity-45 ${estilos[variante]} ${props.className ?? ""}`}
    />
  );
}

/**
 * Barra de gravar. Enquanto o banco não está ligado (etapa A2), ela explica que a
 * escrita passa por function `security definer` e não por ORM, e fica desabilitada:
 * nada aqui finge gravar.
 */
export function SaveBar({
  sujo,
  onGravar,
  onDescartar,
  nota,
}: {
  sujo: boolean;
  onGravar?: () => void;
  onDescartar?: () => void;
  nota?: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="text-muted text-sm">
        {nota ?? "A gravação entra na etapa A2, por function do banco."}
      </p>
      <div className="flex shrink-0 justify-end gap-3">
        <Button variante="secundario" onClick={onDescartar} disabled={!sujo}>
          Descartar
        </Button>
        <Button onClick={onGravar} disabled={!sujo || !onGravar}>
          Gravar
        </Button>
      </div>
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="border-accent bg-accent/10 rounded-input border-l-4 px-4 py-3 text-sm">
      {children}
    </p>
  );
}
