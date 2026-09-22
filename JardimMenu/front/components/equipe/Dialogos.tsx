"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

/**
 * Diálogos da tela da equipe. Toda ação que muda conta ou pedido pede confirmação, e as
 * que o banco registra com motivo (JM-033, JM-141, JM-186) pedem o motivo aqui, de 1 a 140
 * caracteres, o mesmo limite da function.
 */

export const MOTIVO_MAXIMO = 140;

function Moldura({ titulo, children, onFechar }: { titulo: string; children: ReactNode; onFechar: () => void }) {
  const cabecalho = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    cabecalho.current?.focus();
    const fechaComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", fechaComEsc);
    return () => window.removeEventListener("keydown", fechaComEsc);
  }, [onFechar]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialogo-equipe-titulo"
      onClick={onFechar}
    >
      <div
        className="rounded-t-modal sm:rounded-modal bg-surface shadow-float max-h-[92dvh] w-full max-w-md overflow-y-auto p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dialogo-equipe-titulo" ref={cabecalho} tabIndex={-1} className="text-xl font-bold outline-none">
          {titulo}
        </h2>
        {children}
      </div>
    </div>
  );
}

function Botoes({
  rotulo,
  ocupado,
  perigo = false,
  desabilitado = false,
  onVoltar,
}: {
  rotulo: string;
  ocupado: boolean;
  perigo?: boolean;
  desabilitado?: boolean;
  onVoltar: () => void;
}) {
  return (
    <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
      <button
        type="button"
        onClick={onVoltar}
        disabled={ocupado}
        className="jm-touch jm-focus bg-surface border-line rounded-full border-2 px-5 text-base font-semibold"
      >
        Voltar
      </button>
      <button
        type="submit"
        disabled={ocupado || desabilitado}
        className={`jm-touch jm-focus rounded-full px-5 text-base font-bold text-white disabled:opacity-45 sm:flex-1 ${
          perigo ? "bg-danger" : "bg-primary"
        }`}
      >
        {ocupado ? "Enviando…" : rotulo}
      </button>
    </div>
  );
}

/** Executa, mostra a recusa do banco e fecha só se deu certo. */
function useEnvio(executar: () => Promise<void>, onFechar: () => void) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await executar();
      onFechar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível concluir.");
      setOcupado(false);
    }
  }
  return { ocupado, erro, enviar };
}

function Erro({ erro }: { erro: string | null }) {
  return erro ? (
    <p className="mt-3 text-base font-semibold" role="alert">
      {erro}
    </p>
  ) : null;
}

export function DialogoDeConfirmacao({
  titulo,
  texto,
  rotulo,
  perigo,
  onConfirmar,
  onFechar,
}: {
  titulo: string;
  texto: ReactNode;
  rotulo: string;
  perigo?: boolean;
  onConfirmar: () => Promise<void>;
  onFechar: () => void;
}) {
  const { ocupado, erro, enviar } = useEnvio(onConfirmar, onFechar);
  return (
    <Moldura titulo={titulo} onFechar={onFechar}>
      <form onSubmit={enviar}>
        <div className="mt-2 text-base">{texto}</div>
        <Erro erro={erro} />
        <Botoes rotulo={rotulo} ocupado={ocupado} perigo={perigo} onVoltar={onFechar} />
      </form>
    </Moldura>
  );
}

export function DialogoDeMotivo({
  titulo,
  texto,
  rotulo,
  sugestoes = [],
  onConfirmar,
  onFechar,
}: {
  titulo: string;
  texto: ReactNode;
  rotulo: string;
  sugestoes?: string[];
  onConfirmar: (motivo: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const limpo = motivo.trim();
  const { ocupado, erro, enviar } = useEnvio(() => onConfirmar(limpo), onFechar);
  return (
    <Moldura titulo={titulo} onFechar={onFechar}>
      <form onSubmit={enviar}>
        <div className="mt-2 text-base">{texto}</div>
        {sugestoes.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {sugestoes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setMotivo(s)}
                className="jm-touch jm-focus bg-canvas rounded-full px-4 text-sm font-semibold"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <label htmlFor="motivo" className="mt-4 block text-base font-semibold">
          Motivo
        </label>
        <textarea
          id="motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value.slice(0, MOTIVO_MAXIMO))}
          maxLength={MOTIVO_MAXIMO}
          rows={2}
          className="rounded-input border-line bg-canvas jm-focus mt-1 w-full border-2 p-3 text-base"
        />
        <p className="text-muted text-sm">
          {limpo.length}/{MOTIVO_MAXIMO}. Fica registrado com o seu nome e o horário.
        </p>
        <Erro erro={erro} />
        <Botoes rotulo={rotulo} ocupado={ocupado} perigo desabilitado={limpo.length === 0} onVoltar={onFechar} />
      </form>
    </Moldura>
  );
}

export function DialogoDeNome({
  titulo,
  inicial,
  onConfirmar,
  onFechar,
}: {
  titulo: string;
  inicial: string;
  onConfirmar: (nome: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState(inicial);
  const limpo = nome.trim();
  const { ocupado, erro, enviar } = useEnvio(() => onConfirmar(limpo), onFechar);
  return (
    <Moldura titulo={titulo} onFechar={onFechar}>
      <form onSubmit={enviar}>
        <label htmlFor="nome-da-comanda" className="mt-3 block text-base font-semibold">
          Nome
        </label>
        <input
          id="nome-da-comanda"
          value={nome}
          onChange={(e) => setNome(e.target.value.slice(0, 24))}
          maxLength={24}
          autoComplete="off"
          className="rounded-input border-line bg-canvas jm-touch jm-focus mt-1 w-full border-2 px-4 text-base"
        />
        <Erro erro={erro} />
        <Botoes rotulo="Salvar" ocupado={ocupado} desabilitado={limpo.length === 0 || limpo === inicial} onVoltar={onFechar} />
      </form>
    </Moldura>
  );
}

export function DialogoDeMigracao({
  comanda,
  opcoes,
  onConfirmar,
  onFechar,
}: {
  comanda: string;
  opcoes: { id: string; number: number; ocupada: boolean }[];
  onConfirmar: (mesaId: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [destino, setDestino] = useState<string | null>(null);
  const { ocupado, erro, enviar } = useEnvio(() => onConfirmar(destino ?? ""), onFechar);
  return (
    <Moldura titulo={`Migrar a comanda ${comanda}`} onFechar={onFechar}>
      <form onSubmit={enviar}>
        <p className="mt-2 text-base">Os pedidos vão junto para a mesa escolhida (JM-209).</p>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Mesa de destino">
          {opcoes.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={destino === m.id}
              onClick={() => setDestino(m.id)}
              className={`jm-touch jm-focus rounded-input border-2 px-2 text-base font-bold ${
                destino === m.id ? "border-primary bg-canvas" : "border-line bg-surface"
              }`}
            >
              {m.number}
              {m.ocupada ? <span className="text-muted block text-xs font-normal">ocupada</span> : null}
            </button>
          ))}
        </div>
        <Erro erro={erro} />
        <Botoes rotulo="Migrar" ocupado={ocupado} desabilitado={!destino} onVoltar={onFechar} />
      </form>
    </Moldura>
  );
}
