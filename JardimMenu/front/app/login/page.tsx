import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { entrar } from "@back/controllers/sessao";
import { brand } from "@/lib/brand";

/**
 * Login da equipe. É de computador e de celular (a tela da equipe roda no celular do
 * garçom, D30), então aqui o layout é responsivo, ao contrário da tela do cliente.
 */
export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; de?: string }>;
}) {
  const { erro, de } = await searchParams;

  async function acao(formData: FormData) {
    "use server";
    const destino = String(formData.get("de") ?? "/admin");
    const resultado = await entrar({ email: formData.get("email"), senha: formData.get("senha") });
    if (!resultado.ok) {
      redirect(`/login?erro=${encodeURIComponent(resultado.mensagem)}&de=${encodeURIComponent(destino)}`);
    }
    // Só volta para caminho interno: nada de redirecionar para fora do produto.
    redirect(destino.startsWith("/admin") ? destino : "/admin");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form
        action={acao}
        className="rounded-card bg-surface shadow-card w-full max-w-sm space-y-5 p-8"
      >
        <div>
          <h1 className="text-2xl font-bold">{brand.productName}</h1>
          <p className="text-muted mt-1 text-base">Entrada da equipe da loja.</p>
        </div>

        {erro ? (
          <p className="rounded-input bg-canvas border-danger border-2 p-3 text-base" role="alert">
            {erro}
          </p>
        ) : null}

        <input type="hidden" name="de" value={de ?? "/admin"} />

        <label className="block">
          <span className="text-base font-semibold">E-mail</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="rounded-input border-line bg-canvas jm-touch jm-focus mt-1 w-full border-2 px-4 text-base"
          />
        </label>

        <label className="block">
          <span className="text-base font-semibold">Senha</span>
          <input
            name="senha"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            className="rounded-input border-line bg-canvas jm-touch jm-focus mt-1 w-full border-2 px-4 text-base"
          />
        </label>

        <button
          type="submit"
          className="jm-touch jm-focus bg-primary w-full rounded-full px-6 text-base font-semibold text-white"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
