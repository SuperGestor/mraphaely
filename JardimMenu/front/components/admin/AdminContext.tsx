"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getAdminSource, mensagemDe, type AdminSource, type LojaDoUsuario } from "@/lib/admin-source";
import { Hint } from "./ui";

/**
 * Quem está logado e em qual loja. Não é gerenciador de estado global (CLAUDE.md): é o
 * contexto de sessão do painel, lido uma vez, e cada tela continua dona dos seus dados.
 *
 * Um usuário pode ter papel em mais de uma loja. Na Fase A o painel usa a primeira loja
 * ativa; a troca de loja entra quando a segunda casa do portfólio entrar.
 */
interface ValorDoAdmin {
  source: AdminSource;
  loja: LojaDoUsuario;
  email: string | null;
  /** Dono ou gestor: pode editar cardápio, mesas, dispositivos, horário e aparência. */
  gestor: boolean;
  dono: boolean;
}

const Contexto = createContext<ValorDoAdmin | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [valor, setValor] = useState<ValorDoAdmin | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const source = getAdminSource();
    source
      .contexto()
      .then((c) => {
        const loja = c.lojas[0];
        if (!loja) {
          setErro("Seu usuário não está ativo em nenhuma loja. Peça ao dono da casa para te convidar.");
          return;
        }
        setValor({
          source,
          loja,
          email: c.email,
          gestor: loja.role === "owner" || loja.role === "manager",
          dono: loja.role === "owner",
        });
      })
      .catch((e: unknown) => setErro(mensagemDe(e)));
  }, []);

  if (erro) {
    return (
      <div className="p-4 sm:p-8">
        <Hint>{erro}</Hint>
      </div>
    );
  }
  if (!valor) {
    return <p className="text-muted p-4 text-base sm:p-8">Carregando a loja…</p>;
  }

  return (
    <Contexto.Provider value={valor}>
      {valor.source.modo === "exemplo" ? (
        <div className="bg-accent px-4 py-2 text-sm font-semibold text-white sm:px-8" role="status">
          Modo de exemplo: sem banco configurado. As telas leem dados de exemplo e não gravam nada.
        </div>
      ) : null}
      <div className="border-line flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-b px-4 py-2 text-sm sm:px-8">
        <span className="text-muted min-w-0 break-words">
          {valor.loja.nome} · {valor.email ?? "sem e-mail"} · {rotuloDoPapel(valor.loja.role)}
        </span>
        {valor.source.modo === "real" ? (
          <form action="/api/admin/sair" method="post">
            <button type="submit" className="jm-focus jm-touch text-muted underline">
              Sair
            </button>
          </form>
        ) : null}
      </div>
      {children}
    </Contexto.Provider>
  );
}

function rotuloDoPapel(role: LojaDoUsuario["role"]): string {
  return { owner: "Dono", manager: "Gestor", waiter: "Garçom", kitchen: "Cozinha" }[role];
}

export function useAdmin(): ValorDoAdmin {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("useAdmin fora do AdminProvider");
  return valor;
}
