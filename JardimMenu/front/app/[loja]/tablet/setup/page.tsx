"use client";

import { useEffect, useState } from "react";
import { CHAVE_DO_TOKEN } from "@/lib/tablet-source";

/**
 * Tela de pareamento do tablet (/[loja]/tablet/setup, prompt 2 item 5).
 *
 * 1. O tablet lê o QR de configuração com a própria câmera, e o QR abre esta tela com o
 *    código de uso único na URL.
 * 2. A tela tira o código da URL na hora (nem histórico nem barra guardam), e troca o
 *    código pelo token no servidor.
 * 3. O token vai para o armazenamento local do aparelho, que sobrevive a reinício. Ele
 *    nunca aparece em URL, em log ou em outra tela (NF-006).
 *
 * Ainda sem pedido: depois de parear, o tablet só abre o cardápio.
 */
type Estado =
  | { fase: "verificando" }
  | { fase: "pareando" }
  | { fase: "pareado"; loja: string; nomeDaLoja: string; mesa: number | null; agora: boolean }
  | { fase: "sem_codigo" }
  | { fase: "erro"; mensagem: string };

export default function SetupPage() {
  const [estado, setEstado] = useState<Estado>({ fase: "verificando" });

  useEffect(() => {
    const url = new URL(window.location.href);
    const codigo = url.searchParams.get("codigo");

    if (codigo) {
      // O código sai da URL antes de qualquer outra coisa.
      window.history.replaceState(null, "", url.pathname);
      setEstado({ fase: "pareando" });

      fetch("/api/tablet/parear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codigo }),
        cache: "no-store",
      })
        .then(async (r) => {
          const corpo = await r.json().catch(() => null);
          if (!r.ok || !corpo?.token) {
            setEstado({ fase: "erro", mensagem: corpo?.mensagem ?? "Não foi possível parear o tablet." });
            return;
          }
          localStorage.setItem(CHAVE_DO_TOKEN, corpo.token);
          setEstado({ fase: "pareado", loja: corpo.loja, nomeDaLoja: corpo.nomeDaLoja, mesa: corpo.mesa, agora: true });
        })
        .catch(() => setEstado({ fase: "erro", mensagem: "Sem conexão. Confira o Wi-Fi e leia o QR de novo." }));
      return;
    }

    const token = localStorage.getItem(CHAVE_DO_TOKEN);
    if (!token) {
      setEstado({ fase: "sem_codigo" });
      return;
    }

    fetch("/api/tablet/pareamento", { headers: { "x-device-token": token }, cache: "no-store" })
      .then(async (r) => {
        const corpo = await r.json().catch(() => null);
        if (!r.ok) {
          setEstado({ fase: "erro", mensagem: corpo?.mensagem ?? "Este tablet precisa ser pareado de novo." });
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
      .catch(() => setEstado({ fase: "erro", mensagem: "Sem conexão. Confira o Wi-Fi." }));
  }, []);

  function esquecer() {
    localStorage.removeItem(CHAVE_DO_TOKEN);
    setEstado({ fase: "sem_codigo" });
  }

  return (
    <main className="jm-kiosk flex h-dvh items-center justify-center p-10">
      <div className="rounded-card bg-surface shadow-card w-full max-w-xl p-10 text-center">
        <h1 className="text-3xl font-bold">Pareamento do tablet</h1>

        {estado.fase === "verificando" || estado.fase === "pareando" ? (
          <p className="text-muted mt-6 text-lg" role="status">
            {estado.fase === "pareando" ? "Pareando este tablet…" : "Verificando este tablet…"}
          </p>
        ) : null}

        {estado.fase === "pareado" ? (
          <>
            <p className="mt-6 text-lg">
              {estado.agora ? "Tablet pareado com" : "Este tablet já está pareado com"}{" "}
              <strong>{estado.nomeDaLoja}</strong>
            </p>
            {estado.mesa !== null ? (
              <p className="mt-2 text-6xl font-bold tabular-nums">Mesa {estado.mesa}</p>
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
                onClick={esquecer}
                className="jm-touch jm-focus text-muted mt-4 block w-full text-base underline"
              >
                Parear com outro código
              </button>
            ) : null}
          </>
        ) : null}

        {estado.fase === "sem_codigo" ? (
          <p className="text-muted mt-6 text-lg">
            No admin, abra Dispositivos, provisione o tablet desta mesa e leia o QR de
            configuração com a câmera deste aparelho.
          </p>
        ) : null}

        {estado.fase === "erro" ? (
          <>
            <p className="mt-6 text-lg font-semibold" role="alert">
              {estado.mensagem}
            </p>
            <p className="text-muted mt-2 text-base">
              Se o código venceu, gere um novo QR em Dispositivos, no admin.
            </p>
            <button
              type="button"
              onClick={esquecer}
              className="jm-touch jm-focus bg-canvas mt-6 rounded-full px-6 text-base font-semibold"
            >
              Começar de novo
            </button>
          </>
        ) : null}
      </div>
    </main>
  );
}
