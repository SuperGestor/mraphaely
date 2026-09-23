#!/usr/bin/env node
/**
 * Gera os segredos de UM ambiente e grava o .env dele fora do git.
 *
 * Node puro, sem dependência nova: o servidor recém-preparado tem Docker e Node, e não
 * precisa ter npm install de nada para conseguir subir a pilha.
 *
 * O que sai daqui:
 *   - senha do Postgres, usada por todos os serviços da pilha;
 *   - JWT secret do ambiente;
 *   - chaves anon e service_role, que são JWT HS256 assinados com esse segredo, com as
 *     claims que o Supabase espera (role, iss, iat, exp longo);
 *   - os segredos menores que o Realtime, o Storage e o postgres-meta pedem.
 *
 * Uso:
 *   node gerar-segredos.mjs --ambiente staging --ip 203.0.113.10
 *   node gerar-segredos.mjs --ambiente producao --dominio-app app.jardim.com.br \
 *                           --dominio-api api.jardim.com.br
 *
 * Opções:
 *   --ambiente <staging|producao>  obrigatório
 *   --ip <IPv4>                    monta o endereço provisório em sslip.io
 *   --dominio-app <host>           domínio de verdade do app (dispensa --ip)
 *   --dominio-api <host>           domínio de verdade da API (dispensa --ip)
 *   --raiz <caminho>               pasta base no servidor (padrão /opt/jardim)
 *   --saida <arquivo>              caminho exato do .env, se não for o padrão
 *   --anos <n>                     validade das chaves anon e service_role (padrão 10)
 *   --forcar                       sobrescreve um .env que já existe
 *
 * NUNCA rode isto duas vezes no mesmo ambiente sem entender o que acontece: chave nova
 * significa que todo tablet pareado e toda sessão da equipe param de falar com a API, e
 * que o app precisa ser construído de novo (as NEXT_PUBLIC_ entram no bundle no build).
 */

import { createHmac, randomInt } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

function lerArgumentos(lista) {
  const opcoes = {};
  for (let i = 0; i < lista.length; i += 1) {
    const atual = lista[i];
    if (!atual.startsWith("--")) continue;
    const nome = atual.slice(2);
    const proximo = lista[i + 1];
    if (proximo === undefined || proximo.startsWith("--")) {
      opcoes[nome] = true;
    } else {
      opcoes[nome] = proximo;
      i += 1;
    }
  }
  return opcoes;
}

function morrer(mensagem) {
  console.error(`\nerro: ${mensagem}\n`);
  process.exit(1);
}

const opcoes = lerArgumentos(process.argv.slice(2));

const ambiente = opcoes.ambiente;
if (ambiente !== "staging" && ambiente !== "producao") {
  morrer("informe --ambiente staging ou --ambiente producao");
}

const raiz = typeof opcoes.raiz === "string" ? opcoes.raiz : "/opt/jardim";
const destino = typeof opcoes.saida === "string" ? opcoes.saida : join(raiz, "ambientes", `${ambiente}.env`);
const anos = Number(opcoes.anos ?? 10);
if (!Number.isInteger(anos) || anos < 1 || anos > 50) morrer("--anos precisa ser um inteiro de 1 a 50");

// ---------------------------------------------------------------------------
// Endereços do ambiente
// ---------------------------------------------------------------------------

/** sslip.io devolve, em DNS, o IP escrito no próprio nome: 203-0-113-10.sslip.io. */
function nomeSslip(ip) {
  if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip)) {
    morrer(`--ip inválido: ${ip}. Use o IPv4 público do servidor, como 203.0.113.10`);
  }
  if (ip.split(".").some((parte) => Number(parte) > 255)) morrer(`--ip inválido: ${ip}`);
  return `${ip.replaceAll(".", "-")}.sslip.io`;
}

let hostApp = typeof opcoes["dominio-app"] === "string" ? opcoes["dominio-app"] : null;
let hostApi = typeof opcoes["dominio-api"] === "string" ? opcoes["dominio-api"] : null;

if (!hostApp || !hostApi) {
  if (typeof opcoes.ip !== "string") {
    morrer("informe --ip do servidor, ou --dominio-app e --dominio-api");
  }
  const base = nomeSslip(opcoes.ip);
  // Em staging o nome carrega o ambiente; em produção fica curto, porque é o que a
  // equipe vai ler e digitar no tablet.
  const prefixoApp = ambiente === "staging" ? "app-staging" : "app";
  const prefixoApi = ambiente === "staging" ? "api-staging" : "api";
  hostApp = hostApp ?? `${prefixoApp}.${base}`;
  hostApi = hostApi ?? `${prefixoApi}.${base}`;
}

const urlApp = `https://${hostApp}`;
const urlApi = `https://${hostApi}`;

// ---------------------------------------------------------------------------
// Segredos
// ---------------------------------------------------------------------------

// Alfabeto sem símbolo de propósito: a senha do Postgres entra dentro de uma URL de
// conexão (postgres://usuario:senha@db:5432/...), e um "@" ou "/" no meio dela quebra a
// leitura da URL em pelo menos um dos serviços da pilha.
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** randomInt do próprio Node: sorteio uniforme, sem o viés do resto de divisão. */
function segredoAleatorio(tamanho) {
  let saida = "";
  for (let i = 0; i < tamanho; i += 1) saida += ALFABETO[randomInt(0, ALFABETO.length)];
  return saida;
}

const base64url = (valor) => Buffer.from(valor).toString("base64url");

/**
 * JWT HS256 na mão. É uma assinatura de HMAC sobre duas partes em base64url, e não vale
 * trazer uma biblioteca inteira para o servidor por causa disso.
 */
function assinarJwt(claims, segredo) {
  const cabecalho = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const corpo = base64url(JSON.stringify(claims));
  const assinatura = createHmac("sha256", segredo).update(`${cabecalho}.${corpo}`).digest("base64url");
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const agora = Math.floor(Date.now() / 1000);
const expiracao = agora + anos * 365 * 24 * 60 * 60;

const senhaPostgres = segredoAleatorio(40);
const segredoJwt = segredoAleatorio(64);

// As claims são as do self-host do Supabase: papel, emissor, emissão e validade. O
// `iss: supabase` é o que o GoTrue, o PostgREST, o Realtime e o Storage esperam nas
// chaves de projeto; o token de usuário, esse sim, sai com o emissor da API.
const chaveAnon = assinarJwt({ role: "anon", iss: "supabase", iat: agora, exp: expiracao }, segredoJwt);
const chaveServico = assinarJwt({ role: "service_role", iss: "supabase", iat: agora, exp: expiracao }, segredoJwt);

// O Realtime cifra a configuração do tenant com AES-128: a chave tem que ter 16 bytes,
// nem mais nem menos.
const chaveRealtime = segredoAleatorio(16);
const baseSegredoRealtime = segredoAleatorio(64);
const chavePgMeta = segredoAleatorio(32);

// ---------------------------------------------------------------------------
// O arquivo
// ---------------------------------------------------------------------------

const projeto = `jardim-${ambiente}`;
const conteudo = `# Jardim Menu, ambiente ${ambiente}. GERADO por infra/scripts/gerar-segredos.mjs
# em ${new Date().toISOString()}.
#
# ESTE ARQUIVO É SEGREDO. Nunca versione, nunca cole em conversa, nunca mande por e-mail.
# Permissão 600 e dono do usuário de publicação. Se vazar, o caminho é gerar tudo de novo
# e construir a imagem do app de novo.

# ---- identidade do ambiente ----
AMBIENTE=${ambiente}
PROJETO=${projeto}
REDE_BORDA=jardim-borda-${ambiente}

# ---- endereços públicos ----
API_EXTERNAL_URL=${urlApi}
SUPABASE_PUBLIC_URL=${urlApi}
SITE_URL=${urlApp}
ADDITIONAL_REDIRECT_URLS=${urlApp}/**
# Origens de navegador que a API aceita (CORS no Kong). Separe por vírgula.
CORS_ORIGENS=${urlApp}

# ---- segredos do banco e das chaves ----
POSTGRES_PASSWORD=${senhaPostgres}
POSTGRES_DB=postgres
POSTGRES_PORT=5432
JWT_SECRET=${segredoJwt}
JWT_EXPIRY=3600
ANON_KEY=${chaveAnon}
SERVICE_ROLE_KEY=${chaveServico}

# ---- segredos dos serviços ----
SECRET_KEY_BASE=${baseSegredoRealtime}
REALTIME_DB_ENC_KEY=${chaveRealtime}
PG_META_CRYPTO_KEY=${chavePgMeta}
STORAGE_TENANT_ID=${projeto}
REGION=local
GLOBAL_S3_BUCKET=stub

# ---- login da equipe (GoTrue) ----
# Cadastro público fechado: quem entra é convidado pelo dono (JM-060..064).
DISABLE_SIGNUP=true
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=false
# Sem SMTP o convite de usuário não sai. Preencha antes de cadastrar a equipe.
SMTP_ADMIN_EMAIL=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SENDER_NAME=Jardim Menu

# ---- o app ----
IMAGEM_APP=jardim-menu-app
TAG_APP=${ambiente}
NEXT_PUBLIC_SUPABASE_URL=${urlApi}
NEXT_PUBLIC_APP_ORIGIN=${urlApp}
NEXT_PUBLIC_DATA_SOURCE=supabase
# NEXT_PUBLIC_SUPABASE_ANON_KEY não aparece aqui: o compose a preenche com ANON_KEY, para
# não existirem duas cópias da mesma chave que possam divergir.

# ---- alerta (NF-009) ----
# O envio é de outra frente; a pilha só repassa estas duas para o app.
ALERT_TELEGRAM_BOT_TOKEN=
ALERT_TELEGRAM_CHAT_ID=
ALERT_WEBHOOK_URL=

# ---- versões de imagem ----
VERSAO_POSTGRES=17.6.1.167
VERSAO_GOTRUE=v2.196.0
VERSAO_POSTGREST=v16.2
VERSAO_REALTIME=v2.130.0
VERSAO_STORAGE=v1.72.1
VERSAO_META=v0.99.0
VERSAO_KONG=2.8.1
`;

if (existsSync(destino) && opcoes.forcar !== true) {
  morrer(
    `${destino} já existe.\n` +
      "       Gerar de novo troca TODAS as chaves: os tablets pareados param de falar com\n" +
      "       a API e o app precisa ser construído de novo. Se é isso mesmo, guarde uma\n" +
      "       cópia do arquivo atual e repita com --forcar.",
  );
}

mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, conteudo, { encoding: "utf8", mode: 0o600 });
try {
  chmodSync(destino, 0o600);
} catch {
  // Windows não tem permissão de arquivo no mesmo sentido; no servidor Linux, que é
  // onde isto vale, o writeFileSync já nasceu 600.
}

// ---------------------------------------------------------------------------
// O que a pessoa precisa ver
// ---------------------------------------------------------------------------

const recorte = (chave) => `${chave.slice(0, 12)}…${chave.slice(-6)} (${chave.length} caracteres)`;

console.log(`
Ambiente ${ambiente} gerado.

  arquivo .......... ${destino}
  permissão ........ 600, e ele NÃO está no git

Endereços deste ambiente (confira se o DNS aponta para este servidor antes de subir):

  app .............. ${urlApp}
  API .............. ${urlApi}

Vai para o Caddy, no proxy.env:

  HOST_APP_${ambiente.toUpperCase()}=${hostApp}
  HOST_API_${ambiente.toUpperCase()}=${hostApi}

Vai para o app, e já está no .env acima (o publicar.sh lê de lá, não copie na mão):

  NEXT_PUBLIC_SUPABASE_URL=${urlApi}
  NEXT_PUBLIC_SUPABASE_ANON_KEY=${chaveAnon}
  NEXT_PUBLIC_APP_ORIGIN=${urlApp}

Fica só no servidor, nunca sob NEXT_PUBLIC_ (regra 4 do CLAUDE.md):

  SUPABASE_SERVICE_ROLE_KEY=${recorte(chaveServico)}
  POSTGRES_PASSWORD=${recorte(senhaPostgres)}
  JWT_SECRET=${recorte(segredoJwt)}

  As três estão inteiras dentro do arquivo. Não são impressas aqui porque a tela do
  terminal vira histórico, e histórico vaza.

Chaves anon e service_role valem até ${new Date(expiracao * 1000).toISOString().slice(0, 10)}.

Falta preencher à mão antes de usar de verdade:
  SMTP_*                        sem isso o convite de usuário não sai (JM-060)
  ALERT_TELEGRAM_BOT_TOKEN      NF-009
  ALERT_TELEGRAM_CHAT_ID        NF-009
`);
