import { createHash, randomBytes } from "node:crypto";

/**
 * Token do tablet (JM-180, NF-006).
 *
 * - 128 bits de CSPRNG, em base64url: 22 caracteres, cabe no QR de configuração.
 * - O banco guarda só o sha256 em hexadecimal, e o hash é calculado **aqui**: o token em
 *   claro nunca passa pelo Postgres, então não pode cair em log de statement.
 * - O token em claro existe uma única vez, na resposta do provisionamento.
 */
export function gerarTokenDeDispositivo(): string {
  return randomBytes(16).toString("base64url");
}

export function hashDoToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenComFormatoValido(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{22}$/.test(token);
}

/** Lê o header do tablet e devolve o hash, ou nulo se o token não tem formato de token. */
export function hashDoCabecalho(headers: Headers): string | null {
  const token = headers.get("x-device-token");
  return tokenComFormatoValido(token) ? hashDoToken(token) : null;
}
