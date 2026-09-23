// Sobe o servidor do `output: "standalone"`, que é o que a imagem Docker publica.
//
//     npm run build && npm run start:standalone
//
// Por que existir, em vez de `next start`: o Next avisa que `next start` não funciona com
// `output: "standalone"`, e a imagem de produção não usa `next start` — ela roda
// `node server.js` dentro do standalone (front/Dockerfile). Verificar com `next start` é
// verificar um servidor que ninguém vai executar.
//
// O standalone traz o server.js e só as dependências que o rastreamento provou
// necessárias. `.next/static` e `public/` ficam de fora dele e vêm à mão, exatamente como o
// Dockerfile faz com dois COPY. Este script faz esses dois passos e executa o server.js.
//
// As variáveis de ambiente: o server.js do standalone NÃO lê `.env.local`, e `next start`
// lia. Quem as entrega em produção é o compose (infra/docker-compose.yml). Para a máquina
// não ficar com um comando diferente do outro, este script carrega o `.env.local` quando
// ele existe — e em imagem ele não existe, então nada muda em produção.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STANDALONE = path.join(FRONT, ".next", "standalone");
const SERVIDOR = path.join(STANDALONE, "server.js");

const ENV_LOCAL = path.join(FRONT, ".env.local");
if (fs.existsSync(ENV_LOCAL)) {
  process.loadEnvFile(ENV_LOCAL);
  console.log("variáveis de .env.local carregadas (em imagem, quem entrega é o compose)");
}

if (!fs.existsSync(SERVIDOR)) {
  console.error("Não há .next/standalone/server.js. Rode `npm run build` antes.");
  process.exit(2);
}

// cpSync com force: o build pode ter trocado arquivos, e o standalone guarda a cópia antiga.
for (const [de, para] of [
  [path.join(FRONT, ".next", "static"), path.join(STANDALONE, ".next", "static")],
  [path.join(FRONT, "public"), path.join(STANDALONE, "public")],
]) {
  if (fs.existsSync(de)) fs.cpSync(de, para, { recursive: true, force: true });
}

const porta = process.env.PORT ?? "3000";
console.log(`standalone em http://127.0.0.1:${porta} (o mesmo server.js da imagem)`);
const filho = spawn(process.execPath, [SERVIDOR], {
  cwd: STANDALONE,
  stdio: "inherit",
  env: { ...process.env, PORT: porta, HOSTNAME: process.env.HOSTNAME ?? "127.0.0.1" },
});
filho.on("exit", (codigo) => process.exit(codigo ?? 0));
