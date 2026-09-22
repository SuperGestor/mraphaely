"use client";

import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { lerMesaGuardada } from "@/lib/tablet-source";
import { BotaoGarcom, GarcomProvider } from "./Garcom";

/** A tela de erro se recarrega sozinha, para o tablet não ficar parado na mesa (JM-184). */
const RECARREGA_EM_S = 30;

/**
 * Última linha de defesa da tela do cliente: um erro de renderização não deixa a mesa com
 * tela branca. Mostra o número da mesa grande e o botão de garçom (JM-187), que tem
 * provedor próprio aqui, porque a árvore de cima caiu.
 */
export class ErroDoTablet extends Component<{ children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // Sem dado do cliente: só o nome do erro e a pilha dos componentes, no console do aparelho.
    console.error("tela do tablet caiu", erro.name, info.componentStack);
  }

  render() {
    return this.state.falhou ? <TelaDeErro /> : this.props.children;
  }
}

function TelaDeErro() {
  const [mesa] = useState(lerMesaGuardada);
  const [restante, setRestante] = useState(RECARREGA_EM_S);

  useEffect(() => {
    const relogio = setInterval(() => setRestante((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(relogio);
  }, []);

  useEffect(() => {
    if (restante === 0) window.location.reload();
  }, [restante]);

  return (
    <GarcomProvider mesa={mesa} chamadoDoResumo={undefined}>
      <main className="jm-kiosk flex h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
        <p className="text-3xl font-bold sm:text-4xl">Algo travou na tela</p>
        {mesa !== null ? <p className="text-7xl font-bold tabular-nums">Mesa {mesa}</p> : null}
        <p className="text-muted max-w-xl text-lg">Chame a equipe, se precisar. A tela volta sozinha em {restante} s.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <BotaoGarcom grande />
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="jm-touch jm-focus bg-surface border-line rounded-full border-2 px-8 text-xl font-semibold"
          >
            Recarregar agora
          </button>
        </div>
      </main>
    </GarcomProvider>
  );
}
