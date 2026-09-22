"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { CHAVE_DA_MESA, CHAVE_DO_TOKEN } from "@/lib/tablet-source";

/**
 * Configurar este tablet (/[loja]/tablet/setup, JM-180, decisão de 21/09/2026).
 *
 * 1. O dono ou o gestor, no próprio tablet, entra com e-mail e senha e informa a mesa.
 * 2. O servidor faz o login só para parear e o encerra na mesma requisição: nenhum cookie
 *    da equipe fica neste aparelho, que é o que o cliente usa.
 * 3. O token vai para o armazenamento local do aparelho, que sobrevive a reinício. Ele nunca
 *    aparece em URL, em log ou em outra tela (NF-006). Os campos do formulário são limpos.
 */
type Estado =
  | { fase: "verificando" }
  | { fase: "formulario" }
  | { fase: "pareando" }
  | { fase: "pareado"; loja: string; nomeDaLoja: string; mesa: number | null; agora: boolean }
  | { fase: "erro_de_leitura"; mensagem: string };

export default function SetupPage() {
  const { loja } = useParams<{ loja: string }>();
  const [estado, setEstado] = useState<Estado>({ fase: "verificando" });
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mesa, setMesa] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let token: string | null = null;
    try {
      token = localStorage.getItem(CHAVE_DO_TOKEN);
    } catch {
      // Armazenamento bloqueado: segue para o formulário, e o pareamento vai avisar.
    }
    if (!token) {
      setEstado({ fase: "formulario" });
      return;
    }

    fetch("/api/tablet/pareamento", { headers: { "x-device-token": token }, cache: "no-store" })
      .then(async (r) => {
        const corpo = await r.json().catch(() => null);
        if (!r.ok) {
          // Token recusado (desativado, aposentado ou apagado): pareia de novo.
          setAviso(corpo?.mensagem ?? "Este tablet precisa ser pareado de novo.");
          setEstado({ fase: "formulario" });
          return;
        }
        setEstado({
          fase: "pareado",
          loja: corpo.store_slug,
          nomeDaLoja: corpo.store_name,
          mesa: corpo.table_number,
          agora: false,
        });
      })
      .catch(() => setEstado({ fase: "erro_de_leitura", mensagem: "Sem conexão. Confira o Wi-Fi e tente de novo." }));
  }, []);

  async function parear(e: FormEvent) {
    e.preventDefault();
    const numero = Number(mesa);
    if (!Number.isInteger(numero) || numero < 1) {
      setAviso("Informe o número da mesa deste tablet.");
      return;
    }
    setAviso(null);
    setEstado({ fase: "pareando" });

    try {
      const r = await fetch("/api/tablet/configurar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loja, email: email.trim(), senha, mesa: numero }),
        cache: "no-store",
      });
      const corpo = await r.json().catch(() => null);
      // A senha sai da tela em qualquer caso.
      setSenha("");
      if (!r.ok || !corpo?.token) {
        setAviso(corpo?.mensagem ?? "Não foi possível parear o tablet.");
        setEstado({ fase: "formulario" });
        return;
      }
      localStorage.setItem(CHAVE_DO_TOKEN, corpo.token);
      // A mesa fica guardada para a tela de "chame a equipe" mostrar o número mesmo com o
      // token recusado (JM-181, JM-187).
      localStorage.setItem(CHAVE_DA_MESA, String(corpo.mesa));
      setEmail("");
      setMesa("");
      setEstado({ fase: "pareado", loja: corpo.loja, nomeDaLoja: corpo.nomeDaLoja, mesa: corpo.mesa, agora: true });
    } catch {
      setSenha("");
      setAviso("Sem conexão. Confira o Wi-Fi e tente de novo.");
      setEstado({ fase: "formulario" });
    }
  }

  function parearDeNovo() {
    try {
      localStorage.removeItem(CHAVE_DO_TOKEN);
      localStorage.removeItem(CHAVE_DA_MESA);
    } catch {
      // Sem armazenamento, não há token a esquecer.
    }
    setAviso(null);
    setEstado({ fase: "formulario" });
  }

  const campo = "rounded-input border-line bg-canvas jm-touch jm-focus mt-1 w-full border-2 px-4 text-base";

  return (
    <main className="jm-kiosk flex min-h-dvh items-center justify-center p-4 sm:p-10">
      <div className="rounded-card bg-surface shadow-card w-full max-w-xl p-6 sm:p-10">
        <h1 className="text-center text-2xl font-bold sm:text-3xl">Configurar este tablet</h1>

        {estado.fase === "verificando" || estado.fase === "pareando" ? (
          <p className="text-muted mt-6 text-center text-lg" role="status">
            {estado.fase === "pareando" ? "Pareando este tablet…" : "Verificando este tablet…"}
          </p>
        ) : null}

        {estado.fase === "formulario" ? (
          <form onSubmit={parear} className="mt-6 space-y-5" autoComplete="off">
            <p className="text-muted text-base">
              Só o dono ou o gestor da loja pareia o tablet. O login é usado uma vez, para parear, e não fica
              neste aparelho.
            </p>
            {aviso ? (
              <p className="rounded-input bg-canvas border-danger border-2 p-3 text-base" role="alert">
                {aviso}
              </p>
            ) : null}
            <label className="block">
              <span className="text-base font-semibold">E-mail da equipe</span>
              <input
                name="email-equipe"
                type="email"
                required
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={campo}
              />
            </label>
            <label className="block">
              <span className="text-base font-semibold">Senha</span>
              <input
                name="senha-equipe"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className={campo}
              />
            </label>
            <label className="block">
              <span className="text-base font-semibold">Número da mesa deste tablet</span>
              <input
                name="mesa"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                autoComplete="off"
                value={mesa}
                onChange={(e) => setMesa(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className={campo}
              />
            </label>
            <button
              type="submit"
              className="jm-touch jm-focus bg-primary w-full rounded-full px-6 text-lg font-bold text-white"
            >
              Parear este tablet
            </button>
          </form>
        ) : null}

        {estado.fase === "pareado" ? (
          <div className="text-center">
            <p className="mt-6 text-lg">
              {estado.agora ? "Tablet pareado com" : "Este tablet já está pareado com"}{" "}
              <strong>{estado.nomeDaLoja}</strong>
            </p>
            {estado.mesa !== null ? (
              <p className="mt-2 text-5xl font-bold tabular-nums sm:text-6xl">Mesa {estado.mesa}</p>
            ) : null}
            <a
              href={`/${estado.loja}/tablet`}
              className="jm-touch jm-focus bg-primary mt-8 inline-flex items-center justify-center rounded-full px-8 text-lg font-semibold text-white"
            >
              Abrir o cardápio
            </a>
            {!estado.agora ? (
              <button
                type="button"
                onClick={parearDeNovo}
                className="jm-touch jm-focus text-muted mt-4 block w-full text-base underline"
              >
                Parear este tablet de novo
              </button>
            ) : null}
          </div>
        ) : null}

        {estado.fase === "erro_de_leitura" ? (
          <div className="text-center">
            <p className="mt-6 text-lg font-semibold" role="alert">
              {estado.mensagem}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="jm-touch jm-focus bg-canvas mt-6 rounded-full px-6 text-base font-semibold"
            >
              Tentar de novo
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
