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
 *
 * **Por que o contexto tem estado, e não só valor:** a navegação (AdminShell) fica ACIMA
 * do conteúdo na árvore e precisa do papel para esconder a seção que o garçom não abre
 * (JM-062). Então o provedor envolve a casca, e a barra do usuário, o carregando e o erro,
 * que antes moravam aqui, passaram para `ConteudoDoAdmin`, que fica dentro da área de
 * conteúdo, onde sempre estiveram na tela.
 */
interface ValorDoAdmin {
  source: AdminSource;
  loja: LojaDoUsuario;
  email: string | null;
  /** Dono ou gestor: pode editar cardápio, mesas, dispositivos, horário e aparência. */
  gestor: boolean;
  dono: boolean;
}

export type EstadoDoAdmin =
  | { estado: "carregando" }
  | { estado: "erro"; mensagem: string }
  | ({ estado: "pronto" } & ValorDoAdmin);

const Contexto = createContext<EstadoDoAdmin | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoDoAdmin>({ estado: "carregando" });

  useEffect(() => {
    const source = getAdminSource();
    source
      .contexto()
      .then((c) => {
        const loja = c.lojas[0];
        if (!loja) {
          setEstado({
            estado: "erro",
            mensagem: "Seu usuário não está ativo em nenhuma loja. Peça ao dono da casa para te convidar.",
          });
          return;
        }
        setEstado({
          estado: "pronto",
          source,
          loja,
          email: c.email,
          gestor: loja.role === "owner" || loja.role === "manager",
          dono: loja.role === "owner",
        });
      })
      .catch((e: unknown) => setEstado({ estado: "erro", mensagem: mensagemDe(e) }));
  }, []);

  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>;
}

/** Estado cru, para quem precisa desenhar antes da loja existir (a navegação). */
export function useEstadoDoAdmin(): EstadoDoAdmin {
  const estado = useContext(Contexto);
  if (!estado) throw new Error("useEstadoDoAdmin fora do AdminProvider");
  return estado;
}

/** Para as telas, que só são montadas depois da loja carregar (ver ConteudoDoAdmin). */
export function useAdmin(): ValorDoAdmin {
  const estado = useEstadoDoAdmin();
  if (estado.estado !== "pronto") throw new Error("useAdmin antes de a loja carregar");
  return estado;
}

/** Barra do usuário, carregando e erro. Fica dentro da área de conteúdo, ao lado do menu. */
export function ConteudoDoAdmin({ children }: { children: ReactNode }) {
  const estado = useEstadoDoAdmin();

  if (estado.estado === "erro") {
    return (
      <div className="p-4 sm:p-8">
        <Hint>{estado.mensagem}</Hint>
      </div>
    );
  }
  if (estado.estado === "carregando") {
    return <p className="text-muted p-4 text-base sm:p-8">Carregando a loja…</p>;
  }

  return (
    <>
      {estado.source.modo === "exemplo" ? (
        <div className="bg-accent px-4 py-2 text-sm font-semibold text-white sm:px-8" role="status">
          Modo de exemplo: sem banco configurado. As telas leem dados de exemplo e não gravam nada.
        </div>
      ) : null}
      <div className="border-line flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-b px-4 py-2 text-sm sm:px-8">
        <span className="text-muted min-w-0 break-words">
          {estado.loja.nome} · {estado.email ?? "sem e-mail"} · {rotuloDoPapel(estado.loja.role)}
        </span>
        {estado.source.modo === "real" ? (
          <form action="/api/admin/sair" method="post">
            <button type="submit" className="jm-focus jm-touch text-muted underline">
              Sair
            </button>
          </form>
        ) : null}
      </div>
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">{children}</div>
    </>
  );
}

function rotuloDoPapel(role: LojaDoUsuario["role"]): string {
  return { owner: "Dono", manager: "Gestor", waiter: "Garçom", kitchen: "Cozinha" }[role];
}
