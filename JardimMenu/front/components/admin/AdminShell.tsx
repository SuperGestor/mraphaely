"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Casca do painel de configuração, responsiva (15/09/2026):
 *
 * - abaixo de 1024px, uma barra no topo com o botão de menu, que abre a navegação numa
 *   gaveta por cima do conteúdo;
 * - a partir de 1024px, a coluna lateral de sempre, com a opção de minimizar para uma
 *   faixa estreita. A escolha fica guardada neste navegador: é preferência de quem
 *   trabalha no painel, e não dado de cliente.
 */
const CHAVE_DO_MENU = "jm.admin.menu";

export interface SecaoDoAdmin {
  href: string;
  rotulo: string;
  /** Abreviação mostrada com o menu minimizado. */
  sigla: string;
}

function IconeMenu() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function AdminShell({
  produto,
  secoes,
  children,
}: {
  produto: string;
  secoes: SecaoDoAdmin[];
  children: ReactNode;
}) {
  const caminho = usePathname();
  const [minimizado, setMinimizado] = useState(false);
  const [gavetaAberta, setGavetaAberta] = useState(false);

  useEffect(() => {
    try {
      setMinimizado(window.localStorage.getItem(CHAVE_DO_MENU) === "minimizado");
    } catch {
      // Armazenamento bloqueado: o menu começa aberto.
    }
  }, []);

  // Navegar fecha a gaveta do celular.
  useEffect(() => {
    setGavetaAberta(false);
  }, [caminho]);

  useEffect(() => {
    if (!gavetaAberta) return;
    const fechaComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGavetaAberta(false);
    };
    window.addEventListener("keydown", fechaComEsc);
    return () => window.removeEventListener("keydown", fechaComEsc);
  }, [gavetaAberta]);

  function alternarMinimizado() {
    const novo = !minimizado;
    setMinimizado(novo);
    try {
      window.localStorage.setItem(CHAVE_DO_MENU, novo ? "minimizado" : "aberto");
    } catch {
      // Sem armazenamento, a escolha vale só nesta aba.
    }
  }

  const ativo = (href: string) => (href === "/admin" ? caminho === "/admin" : caminho.startsWith(href));

  function navegacao(compacta: boolean) {
    return (
      <nav className={`flex-1 overflow-y-auto pb-4 ${compacta ? "px-2" : "px-3"}`} aria-label="Seções da configuração">
        {secoes.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            aria-current={ativo(s.href) ? "page" : undefined}
            aria-label={compacta ? s.rotulo : undefined}
            title={compacta ? s.rotulo : undefined}
            className={`jm-touch jm-focus mb-1 flex items-center rounded-full text-base ${
              compacta ? "justify-center px-0 font-semibold" : "px-4"
            } ${ativo(s.href) ? "text-ink bg-white" : "text-white/90 hover:bg-white/10"}`}
          >
            {compacta ? s.sigla : s.rotulo}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Abaixo de 1024px: barra do topo com o botão de menu. */}
      <header className="bg-primary sticky top-0 z-30 flex items-center gap-3 px-3 py-2 text-white lg:hidden">
        <button
          type="button"
          onClick={() => setGavetaAberta(true)}
          aria-label="Abrir o menu"
          aria-expanded={gavetaAberta}
          className="jm-touch jm-focus flex items-center justify-center rounded-full px-2 hover:bg-white/10"
        >
          <IconeMenu />
        </button>
        <div className="min-w-0">
          <p className="truncate text-base leading-tight font-semibold">{produto}</p>
          <p className="text-xs text-white/70">Configuração da loja</p>
        </div>
      </header>

      {gavetaAberta ? (
        <div className="fixed inset-0 z-40 bg-black/45 lg:hidden" onClick={() => setGavetaAberta(false)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menu da configuração"
            className="bg-primary flex h-full w-72 max-w-[85vw] flex-col text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{produto}</p>
                <p className="text-sm text-white/70">Configuração da loja</p>
              </div>
              <button
                type="button"
                onClick={() => setGavetaAberta(false)}
                aria-label="Fechar o menu"
                className="jm-touch jm-focus flex shrink-0 items-center justify-center rounded-full px-3 text-xl hover:bg-white/10"
              >
                ✕
              </button>
            </div>
            {navegacao(false)}
          </aside>
        </div>
      ) : null}

      {/* A partir de 1024px: coluna lateral, que pode ser minimizada. */}
      <aside
        className={`bg-primary sticky top-0 hidden h-dvh shrink-0 flex-col text-white lg:flex ${
          minimizado ? "w-[76px]" : "w-60"
        }`}
      >
        <div className={`flex items-center gap-2 pt-5 pb-4 ${minimizado ? "justify-center px-2" : "justify-between px-5"}`}>
          {minimizado ? null : (
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{produto}</p>
              <p className="text-sm text-white/70">Configuração da loja</p>
            </div>
          )}
          <button
            type="button"
            onClick={alternarMinimizado}
            aria-label={minimizado ? "Expandir o menu" : "Minimizar o menu"}
            aria-expanded={!minimizado}
            title={minimizado ? "Expandir o menu" : "Minimizar o menu"}
            className="jm-touch jm-focus flex shrink-0 items-center justify-center rounded-full px-3 text-lg font-bold hover:bg-white/10"
          >
            {minimizado ? "»" : "«"}
          </button>
        </div>
        {navegacao(minimizado)}
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
