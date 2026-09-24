#!/usr/bin/env bash
#
# Publica UM ambiente do Jardim Menu (NF-012: staging separado de produção, com
# procedimento de publicação escrito — este arquivo é o procedimento).
#
#   bash publicar.sh staging
#   bash publicar.sh producao
#
# A ordem é sempre a mesma, e é ela que dá a garantia:
#
#   1. confere ambiente, .env, revisão do git e estado da pilha;
#   2. em PRODUÇÃO, recusa qualquer migração que não tenha rodado em staging antes,
#      comparando versão E conteúdo (sha256). Sem isso a publicação para, e não há
#      opção de linha de comando que dispense a checagem;
#   3. constrói a imagem do app deste ambiente (as NEXT_PUBLIC_ entram no build);
#   4. confere que a service_role não vazou para o bundle do navegador (regra 4);
#   5. sobe/garante a pilha do Supabase e espera o banco ficar saudável;
#   6. em produção, tira um backup antes de tocar no banco (NF-011);
#   7. PARA o app;
#   8. aplica as migrações pendentes, uma a uma, registrando cada uma no banco;
#   9. SOBE o app e espera o /api/saude responder;
#  10. escreve a linha do que aconteceu em <raiz>/logs/publicacao.log.
#
# O seed.sql NUNCA é aplicado, em ambiente nenhum: ele é massa de desenvolvimento, com
# usuário e senha fictícios, e existe só para o `supabase db reset` da máquina de quem
# programa. Como criar o primeiro dono em produção, com segurança, está no README e no
# criar-primeiro-dono.sh, que convida por e-mail em vez de inventar senha.
#
# Opções:
#   --raiz <caminho>     pasta base no servidor            (padrão /opt/jardim)
#   --env <arquivo>      .env do ambiente                  (padrão <raiz>/ambientes/<amb>.env)
#   --sem-build          não reconstrói a imagem do app
#   --sem-migracoes      não toca no banco (só troca a versão do app)
#   --so-migracoes       aplica as migrações e sai, sem mexer no app
#   --sem-backup         pula o backup de produção. Só com --sim, e fica no log
#   --permitir-sujo      publica com a árvore do git suja (proibido em produção)
#   --sim                não pergunta nada
#
# NÃO existe opção para pular a checagem de staging. Se ela incomodar, o caminho é
# publicar em staging primeiro, que é o ponto.

set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Conversa com quem está rodando
# ---------------------------------------------------------------------------

titulo() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
feito()  { printf '   \033[32mok\033[0m    %s\n' "$*"; }
nota()   { printf '         %s\n' "$*"; }
aviso()  { printf '   \033[33matencao\033[0m %s\n' "$*"; }
morrer() { printf '\n\033[31mPUBLICACAO INTERROMPIDA:\033[0m %s\n\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Onde estão as coisas
# ---------------------------------------------------------------------------

DIR_SCRIPTS="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DIR_INFRA="$(cd -- "$DIR_SCRIPTS/.." && pwd)"
DIR_JARDIM="$(cd -- "$DIR_INFRA/.." && pwd)"
COMPOSE="$DIR_INFRA/docker-compose.yml"
DIR_MIGRACOES="$DIR_JARDIM/back/supabase/migrations"

# ---------------------------------------------------------------------------
# Opções
# ---------------------------------------------------------------------------

AMBIENTE="${1:-}"
case "$AMBIENTE" in
  staging|producao) shift ;;
  -h|--ajuda|--help) sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) morrer "uso: bash publicar.sh <staging|producao> [opções] (--ajuda mostra o resto)" ;;
esac

RAIZ=/opt/jardim
ARQUIVO_ENV=""
FAZER_BUILD=sim
FAZER_MIGRACOES=sim
MEXER_NO_APP=sim
FAZER_BACKUP=padrao
PERMITIR_SUJO=nao
PERGUNTAR=sim

while [ $# -gt 0 ]; do
  case "$1" in
    --raiz)          RAIZ="${2:?--raiz exige um caminho}"; shift 2 ;;
    --env)           ARQUIVO_ENV="${2:?--env exige um arquivo}"; shift 2 ;;
    --sem-build)     FAZER_BUILD=nao; shift ;;
    --sem-migracoes) FAZER_MIGRACOES=nao; shift ;;
    --so-migracoes)  MEXER_NO_APP=nao; FAZER_BUILD=nao; shift ;;
    --sem-backup)    FAZER_BACKUP=nao; shift ;;
    --permitir-sujo) PERMITIR_SUJO=sim; shift ;;
    --sim)           PERGUNTAR=nao; shift ;;
    -h|--ajuda|--help) sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) morrer "opção desconhecida: $1" ;;
  esac
done

ARQUIVO_ENV="${ARQUIVO_ENV:-$RAIZ/ambientes/$AMBIENTE.env}"
ENV_STAGING="$RAIZ/ambientes/staging.env"
ARQUIVO_LOG="$RAIZ/logs/publicacao.log"

# ---------------------------------------------------------------------------
# Ler o .env sem executá-lo
#
# `source` num .env é armadilho: uma linha como SMTP_SENDER_NAME=Jardim Menu vira o
# comando `Menu` com a variável no ambiente. O docker compose lê esse formato direito,
# nós lemos linha a linha. Só os valores que o script precisa.
# ---------------------------------------------------------------------------

ler_var() {
  # $1 arquivo, $2 nome. Última ocorrência vence, como no compose. O tr tira o \r de um
  # arquivo que tenha passado por editor de Windows: senha com \r no fim não conecta, e o
  # erro que aparece não fala nada de \r.
  sed -n "s/^[[:space:]]*$2=//p" "$1" | tail -n 1 | tr -d '\r'
}

# ---------------------------------------------------------------------------
# Falar com o Docker
# ---------------------------------------------------------------------------

container_de() {
  # $1 projeto do compose, $2 serviço. Vazio quando não está de pé.
  docker ps \
    --filter "label=com.docker.compose.project=$1" \
    --filter "label=com.docker.compose.service=$2" \
    --filter "status=running" \
    --format '{{.ID}}' | head -n 1
}

compose() {
  docker compose -p "$PROJETO" --env-file "$ARQUIVO_ENV" -f "$COMPOSE" "$@"
}

# Como falar com o psql de um contêiner db. Duas formas, na ordem da mais segura:
# pelo socket local, como o usuário postgres (não passa senha em lugar nenhum), e, se o
# pg_hba do ambiente não deixar, por TCP no próprio contêiner, com a senha em variável.
montar_psql() {
  # $1 id do contêiner, $2 banco, $3 porta, $4 senha. Imprime os argumentos do docker.
  local id="$1" banco="$2" porta="$3" senha="$4"
  if docker exec -u postgres "$id" psql -h /var/run/postgresql -U postgres -d "$banco" \
      -Atqc 'select 1' >/dev/null 2>&1; then
    printf 'exec\n-i\n-u\npostgres\n%s\npsql\n-h\n/var/run/postgresql\n-U\npostgres\n-d\n%s\n' "$id" "$banco"
  elif docker exec -e "PGPASSWORD=$senha" "$id" psql -h 127.0.0.1 -p "$porta" -U postgres -d "$banco" \
      -Atqc 'select 1' >/dev/null 2>&1; then
    printf 'exec\n-i\n-e\nPGPASSWORD=%s\n%s\npsql\n-h\n127.0.0.1\n-p\n%s\n-U\npostgres\n-d\n%s\n' \
      "$senha" "$id" "$porta" "$banco"
  else
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 1. Conferências
# ---------------------------------------------------------------------------

titulo "Conferências"

command -v docker >/dev/null 2>&1 || morrer "docker não encontrado. Rode o preparar-servidor.sh antes."
docker compose version >/dev/null 2>&1 || morrer "plugin docker compose não encontrado (preparar-servidor.sh)."
docker info >/dev/null 2>&1 || morrer "o Docker não responde. Seu usuário está no grupo docker? Saiu e entrou de novo?"
[ -f "$COMPOSE" ] || morrer "não achei $COMPOSE"
[ -d "$DIR_MIGRACOES" ] || morrer "não achei $DIR_MIGRACOES"
[ -f "$ARQUIVO_ENV" ] || morrer "não achei $ARQUIVO_ENV.
       Gere com: node $DIR_SCRIPTS/gerar-segredos.mjs --ambiente $AMBIENTE --ip <IP do servidor>"

# O .env tem TODOS os segredos do ambiente. 600, e só isso.
PERMISSAO="$(stat -c '%a' "$ARQUIVO_ENV" 2>/dev/null || echo '?')"
[ "$PERMISSAO" = "600" ] || aviso "$ARQUIVO_ENV está $PERMISSAO, e devia estar 600 (chmod 600)."

PROJETO="$(ler_var "$ARQUIVO_ENV" PROJETO)"
[ -n "$PROJETO" ] || morrer "PROJETO não está definido em $ARQUIVO_ENV"
AMBIENTE_NO_ENV="$(ler_var "$ARQUIVO_ENV" AMBIENTE)"
[ "$AMBIENTE_NO_ENV" = "$AMBIENTE" ] || morrer \
  "o arquivo diz AMBIENTE=$AMBIENTE_NO_ENV e você pediu $AMBIENTE. Publicar o .env errado
       apontaria o app de um ambiente para o banco do outro."

BANCO="$(ler_var "$ARQUIVO_ENV" POSTGRES_DB)";        BANCO="${BANCO:-postgres}"
PORTA_BANCO="$(ler_var "$ARQUIVO_ENV" POSTGRES_PORT)"; PORTA_BANCO="${PORTA_BANCO:-5432}"
SENHA_BANCO="$(ler_var "$ARQUIVO_ENV" POSTGRES_PASSWORD)"
REDE_BORDA="$(ler_var "$ARQUIVO_ENV" REDE_BORDA)"
IMAGEM="$(ler_var "$ARQUIVO_ENV" IMAGEM_APP):$(ler_var "$ARQUIVO_ENV" TAG_APP)"
CHAVE_SERVICO="$(ler_var "$ARQUIVO_ENV" SERVICE_ROLE_KEY)"
URL_APP="$(ler_var "$ARQUIVO_ENV" NEXT_PUBLIC_APP_ORIGIN)"
URL_API="$(ler_var "$ARQUIVO_ENV" API_EXTERNAL_URL)"

for OBRIGATORIA in SENHA_BANCO REDE_BORDA CHAVE_SERVICO URL_APP URL_API; do
  [ -n "${!OBRIGATORIA}" ] || morrer "$OBRIGATORIA vazia em $ARQUIVO_ENV. O arquivo está pela metade?"
done
case "$URL_APP$URL_API" in
  *"<"*) morrer "ainda há espaço reservado <...> em $ARQUIVO_ENV. Preencha os endereços antes." ;;
esac

docker network inspect "$REDE_BORDA" >/dev/null 2>&1 \
  || morrer "a rede $REDE_BORDA não existe. Rode o preparar-servidor.sh, ou:
       docker network create $REDE_BORDA"

feito "ambiente $AMBIENTE, projeto $PROJETO, imagem $IMAGEM"

# Revisão publicada. Em produção a árvore precisa estar limpa: sem isso ninguém consegue
# dizer, depois, qual código está no ar (NF-012).
REVISAO="sem-git"
if git -C "$DIR_JARDIM" rev-parse --git-dir >/dev/null 2>&1; then
  REVISAO="$(git -C "$DIR_JARDIM" rev-parse --short HEAD)"
  if [ -n "$(git -C "$DIR_JARDIM" status --porcelain)" ]; then
    if [ "$AMBIENTE" = "producao" ] && [ "$PERMITIR_SUJO" = "nao" ]; then
      morrer "a árvore do git tem mudança não commitada.
       Em produção isso é recusado: a revisão no ar precisa existir no histórico.
       Commite (ou descarte) e publique de novo. Se for mesmo o caso, --permitir-sujo."
    fi
    aviso "árvore suja: o que está no ar não é exatamente a revisão $REVISAO"
    REVISAO="$REVISAO-sujo"
  fi
  feito "revisão $REVISAO"
fi

# Massa de desenvolvimento nunca sai da máquina de quem programa.
[ -f "$DIR_MIGRACOES/seed.sql" ] && morrer \
  "há um seed.sql dentro de $DIR_MIGRACOES.
       Massa de desenvolvimento (usuários e senha fictícios) não sobe para servidor
       nenhum. Tire o arquivo de lá."

# A pasta de migrações só pode ter migração. Qualquer outro .sql aqui viraria parte da
# publicação sem ninguém ter decidido isso.
MIGRACOES=()
while IFS= read -r CAMINHO; do
  NOME_ARQUIVO="$(basename "$CAMINHO")"
  case "$NOME_ARQUIVO" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql) MIGRACOES+=("$CAMINHO") ;;
    *) morrer "arquivo fora do padrão em $DIR_MIGRACOES: $NOME_ARQUIVO
       O nome precisa ser <14 dígitos>_<nome>.sql, como o Supabase gera." ;;
  esac
done < <(find "$DIR_MIGRACOES" -maxdepth 1 -type f -name '*.sql' | sort)
[ "${#MIGRACOES[@]}" -gt 0 ] || morrer "nenhuma migração em $DIR_MIGRACOES"
feito "${#MIGRACOES[@]} migrações no repositório"

# ---------------------------------------------------------------------------
# 2. Confirmação de produção
# ---------------------------------------------------------------------------

if [ "$AMBIENTE" = "producao" ] && [ "$PERGUNTAR" = "sim" ]; then
  titulo "Produção"
  cat <<AVISO
  Isto mexe no ambiente que a loja usa de verdade:

    app ............ $URL_APP
    API ............ $URL_API
    revisão ........ $REVISAO

  O app fica fora do ar enquanto as migrações rodam. Durante esse tempo o tablet não
  envia pedido e o botão de chamar o garçom não funciona (JM-187), então faça isto com
  a casa fechada.

AVISO
  printf '  Digite producao para seguir: '
  read -r RESPOSTA
  [ "$RESPOSTA" = "producao" ] || morrer "não confirmado, nada foi alterado"
fi

# ---------------------------------------------------------------------------
# 3. Quais migrações faltam neste ambiente
# ---------------------------------------------------------------------------

SQL_REGISTRO=$(cat <<'SQL'
create schema if not exists jardim_publicacao;
comment on schema jardim_publicacao is 'Registro de publicacao (NF-012). Fora do dominio, fora da API.';
revoke all on schema jardim_publicacao from public;
create table if not exists jardim_publicacao.migracoes (
  versao text primary key,
  arquivo text not null,
  sha256 text not null,
  aplicada_em timestamptz not null default now(),
  aplicada_por text not null,
  revisao_git text
);
comment on table jardim_publicacao.migracoes is
  'O que ja rodou neste banco. O sha256 e o do arquivo: e ele que prova que o que rodou em producao foi o mesmo que rodou em staging.';
-- Mesma tabela que o Supabase CLI usa, para quem um dia apontar o `supabase db push`
-- para este banco nao tentar aplicar tudo de novo.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL
)

versoes_aplicadas() {
  # $1 projeto, $2 arquivo .env. Imprime "<versao> <sha256>" por linha, ou nada.
  local projeto="$1" env_arq="$2" id banco porta senha
  id="$(container_de "$projeto" db)"
  [ -n "$id" ] || return 2
  banco="$(ler_var "$env_arq" POSTGRES_DB)"; banco="${banco:-postgres}"
  porta="$(ler_var "$env_arq" POSTGRES_PORT)"; porta="${porta:-5432}"
  senha="$(ler_var "$env_arq" POSTGRES_PASSWORD)"
  local args=()
  mapfile -t args < <(montar_psql "$id" "$banco" "$porta" "$senha") || return 3
  docker "${args[@]}" -Atq -c \
    "select versao || ' ' || sha256 from jardim_publicacao.migracoes order by versao" 2>/dev/null
}

sha_de() {
  sha256sum "$1" | cut -d' ' -f1
}

titulo "Migrações"

# O banco precisa estar de pé para sabermos o que falta. Se a pilha nunca subiu, subimos
# só o banco agora — é a primeira publicação do ambiente.
ID_DB="$(container_de "$PROJETO" db)"
if [ -z "$ID_DB" ]; then
  nota "banco deste ambiente ainda não está de pé; subindo"
  compose up -d db
  ID_DB=""
  for _ in $(seq 1 60); do
    ID_DB="$(container_de "$PROJETO" db)"
    [ -n "$ID_DB" ] && break
    sleep 2
  done
  [ -n "$ID_DB" ] || morrer "o contêiner do banco não subiu. Veja: docker compose -p $PROJETO logs db"
fi

# Esperar o healthcheck, e não só o contêiner existir: o Postgres do Supabase roda os
# scripts de inicialização (roles, jwt, realtime) antes de aceitar conexão.
for _ in $(seq 1 90); do
  ESTADO="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-healthcheck{{end}}' "$ID_DB" 2>/dev/null || echo desconhecido)"
  [ "$ESTADO" = "healthy" ] && break
  [ "$ESTADO" = "sem-healthcheck" ] && break
  sleep 2
done
[ "${ESTADO:-}" = "healthy" ] || [ "${ESTADO:-}" = "sem-healthcheck" ] \
  || morrer "o banco não ficou saudável (estado: ${ESTADO:-desconhecido}).
       Veja: docker compose -p $PROJETO --env-file $ARQUIVO_ENV -f $COMPOSE logs db"

ARGS_PSQL=()
mapfile -t ARGS_PSQL < <(montar_psql "$ID_DB" "$BANCO" "$PORTA_BANCO" "$SENHA_BANCO") \
  || morrer "não consegui falar com o psql do contêiner do banco."
[ "${#ARGS_PSQL[@]}" -gt 0 ] || morrer "não consegui falar com o psql do contêiner do banco."

psql_rodar() { docker "${ARGS_PSQL[@]}" -v ON_ERROR_STOP=1 "$@"; }

printf '%s\n' "$SQL_REGISTRO" | psql_rodar -q >/dev/null
feito "registro de publicação pronto no banco"

APLICADAS_AQUI="$(psql_rodar -Atq -c 'select versao from jardim_publicacao.migracoes')"

PENDENTES=()
for CAMINHO in "${MIGRACOES[@]}"; do
  VERSAO="$(basename "$CAMINHO" | cut -d_ -f1)"
  if printf '%s\n' "$APLICADAS_AQUI" | grep -qxF "$VERSAO"; then continue; fi
  PENDENTES+=("$CAMINHO")
done

if [ "${#PENDENTES[@]}" -eq 0 ]; then
  feito "nenhuma migração pendente"
else
  feito "${#PENDENTES[@]} pendente(s):"
  for CAMINHO in "${PENDENTES[@]}"; do nota "- $(basename "$CAMINHO")"; done
fi

# ---------------------------------------------------------------------------
# 4. A recusa (NF-012): produção não recebe migração que staging não recebeu
#
# Comparamos versão E sha256 do arquivo. Versão igual com conteúdo diferente significa
# que alguém editou a migração depois de ela ter rodado em staging, e então o que seria
# aplicado em produção nunca foi exercitado em lugar nenhum.
# ---------------------------------------------------------------------------

if [ "$AMBIENTE" = "producao" ] && [ "${#PENDENTES[@]}" -gt 0 ] && [ "$FAZER_MIGRACOES" = "sim" ]; then
  titulo "Conferindo o staging"

  [ -f "$ENV_STAGING" ] || morrer \
    "não achei $ENV_STAGING.
       Produção não recebe migração que não passou por staging (NF-012), e sem o .env
       do staging não há como conferir. Crie o staging primeiro."

  APLICADAS_STAGING=""
  if ! APLICADAS_STAGING="$(versoes_aplicadas "jardim-staging" "$ENV_STAGING")"; then
    morrer "não consegui ler o registro de publicação do staging.
       A pilha de staging está de pé? Tente:
         bash $0 staging
       Produção não recebe migração que não rodou em staging antes (NF-012)."
  fi

  FALTOU=0
  for CAMINHO in "${PENDENTES[@]}"; do
    NOME_ARQUIVO="$(basename "$CAMINHO")"
    VERSAO="${NOME_ARQUIVO%%_*}"
    SHA="$(sha_de "$CAMINHO")"
    LINHA_STAGING="$(printf '%s\n' "$APLICADAS_STAGING" | awk -v v="$VERSAO" '$1 == v {print $2; exit}')"
    if [ -z "$LINHA_STAGING" ]; then
      printf '   \033[31mnao rodou em staging\033[0m  %s\n' "$NOME_ARQUIVO"
      FALTOU=$((FALTOU + 1))
    elif [ "$LINHA_STAGING" != "$SHA" ]; then
      printf '   \033[31mmudou depois do staging\033[0m %s\n' "$NOME_ARQUIVO"
      nota "  staging rodou o arquivo com sha256 $LINHA_STAGING"
      nota "  aqui o arquivo está com     sha256 $SHA"
      FALTOU=$((FALTOU + 1))
    else
      feito "$NOME_ARQUIVO já rodou em staging, com o mesmo conteúdo"
    fi
  done

  [ "$FALTOU" -eq 0 ] || morrer \
    "$FALTOU migração(ões) não passaram por staging.
       Publique em staging, confira que a loja de teste continua funcionando, e só
       então volte aqui:
         bash $0 staging
       Esta checagem não tem como ser desligada, de propósito (NF-012)."
fi

# ---------------------------------------------------------------------------
# 5. A imagem do app
# ---------------------------------------------------------------------------

if [ "$FAZER_BUILD" = "sim" ]; then
  titulo "Imagem do app"
  nota "as NEXT_PUBLIC_ entram no bundle agora, no build: esta imagem serve só ao $AMBIENTE"
  # O commit vai para dentro da imagem (JM-184): é ele que o heartbeat do tablet devolve,
  # e é por ele que se sabe se um aparelho ficou numa versão antiga depois da publicação.
  # Fora de um checkout git, segue vazio, e vale só a versão do package.json.
  JM_COMMIT="$(git -C "$RAIZ" rev-parse --short HEAD 2>/dev/null || true)"
  export JM_COMMIT
  if [ -n "$JM_COMMIT" ]; then nota "commit desta imagem: $JM_COMMIT"; fi
  compose build app
  feito "imagem $IMAGEM construída"

  # Regra 4 do CLAUDE.md, e §9.4 dos requisitos: a service_role não pode aparecer no que
  # o navegador baixa. A chave vai por stdin, e não como argumento, para não ficar
  # visível no `ps` de quem estiver logado na máquina.
  titulo "Conferindo o bundle"
  SAIDA_GREP="$(printf '%s' "$CHAVE_SERVICO" \
    | docker run --rm -i --entrypoint sh "$IMAGEM" -c \
        'read -r chave; grep -rlF "$chave" /app/.next/static /app/public 2>/dev/null || true')"
  if [ -n "$SAIDA_GREP" ]; then
    morrer "a service_role apareceu no bundle do navegador:
$SAIDA_GREP
       Isso entrega o banco inteiro a quem abrir o cardápio. Procure por uma variável
       NEXT_PUBLIC_ recebendo a chave de serviço (regra 4 do CLAUDE.md)."
  fi
  feito "service_role não aparece em .next/static nem em public/"
fi

# ---------------------------------------------------------------------------
# 6. A pilha de pé
# ---------------------------------------------------------------------------

titulo "Pilha do Supabase"
compose up -d db auth rest realtime storage meta kong
feito "db, auth, rest, realtime, storage, meta e kong de pé"

# ---------------------------------------------------------------------------
# 7. Backup antes de mexer no banco (NF-011)
# ---------------------------------------------------------------------------

if [ "${#PENDENTES[@]}" -gt 0 ] && [ "$FAZER_MIGRACOES" = "sim" ]; then
  if [ "$AMBIENTE" = "producao" ] && [ "$FAZER_BACKUP" = "nao" ]; then
    aviso "backup pulado por --sem-backup. Vai ficar registrado no log."
  elif [ "$AMBIENTE" = "producao" ] || [ "$FAZER_BACKUP" = "sim" ]; then
    titulo "Backup antes da migração"
    # O backup.sh mora em infra/backup/, e não ao lado deste script. Ele se configura por
    # /etc/jardim-menu/backup.env (ou JARDIM_BACKUP_ENV) e recebe o ambiente por --ambiente:
    # não existem --raiz nem --etiqueta. Com o caminho e a interface errados, produção com
    # migração pendente batia no `morrer` abaixo e NUNCA conseguia migrar.
    #
    # --somente-banco de propósito: o que a migração pode estragar é o banco, e as fotos
    # ficam para a rodada noturna. `|| morrer` porque backup que falhou não é backup.
    BACKUP="$DIR_INFRA/backup/backup.sh"
    if [ -f "$BACKUP" ]; then
      bash "$BACKUP" --ambiente "$AMBIENTE" --somente-banco \
        || morrer "o backup falhou, e produção não migra sem backup (NF-011)."
      feito "backup do banco guardado antes de migrar"
    else
      morrer "não achei $BACKUP, e produção não migra sem backup (NF-011)."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 8. O app para, as migrações rodam, o app volta
# ---------------------------------------------------------------------------

APP_PAROU=nao
if [ "${#PENDENTES[@]}" -gt 0 ] && [ "$FAZER_MIGRACOES" = "sim" ] && [ "$MEXER_NO_APP" = "sim" ]; then
  titulo "Parando o app"
  # Migração com o app atendendo é o caminho para erro de coluna que não existe mais no
  # meio de um pedido. O app fica fora do ar de propósito, e volta logo abaixo.
  compose stop app >/dev/null 2>&1 || true
  APP_PAROU=sim
  feito "app parado"
fi

MIGRACOES_APLICADAS=0
if [ "$FAZER_MIGRACOES" = "nao" ]; then
  aviso "migrações puladas por --sem-migracoes"
elif [ "${#PENDENTES[@]}" -gt 0 ]; then
  titulo "Aplicando migrações"
  QUEM="$(id -un 2>/dev/null || echo desconhecido)@$(hostname 2>/dev/null || echo servidor)"
  QUEM="$(printf '%s' "$QUEM" | tr -cd 'A-Za-z0-9@._-')"

  for CAMINHO in "${PENDENTES[@]}"; do
    NOME_ARQUIVO="$(basename "$CAMINHO")"
    VERSAO="${NOME_ARQUIVO%%_*}"
    NOME_CURTO="${NOME_ARQUIVO#*_}"; NOME_CURTO="${NOME_CURTO%.sql}"
    SHA="$(sha_de "$CAMINHO")"
    printf '   aplicando  %s\n' "$NOME_ARQUIVO"

    # Cada migração do projeto abre e fecha a própria transação (begin;/commit; dentro do
    # arquivo), então NÃO usamos --single-transaction: seria transação dentro de
    # transação, e o commit do arquivo fecharia a nossa no meio. O ON_ERROR_STOP=1 é que
    # garante a parada no primeiro erro.
    #
    # O registro vai logo depois, no mesmo psql. Se a migração passar e o registro falhar
    # (praticamente impossível: é um insert em tabela nossa), a publicação para aqui e a
    # mensagem diz o que inserir à mão.
    if ! {
      cat "$CAMINHO"
      printf '\n'
      cat <<SQL
insert into jardim_publicacao.migracoes (versao, arquivo, sha256, aplicada_por, revisao_git)
values ('$VERSAO', '$NOME_ARQUIVO', '$SHA', '$QUEM', '$REVISAO')
on conflict (versao) do nothing;
insert into supabase_migrations.schema_migrations (version, name)
values ('$VERSAO', '$NOME_CURTO')
on conflict (version) do nothing;
SQL
    } | psql_rodar -q >/dev/null; then
      morrer "a migração $NOME_ARQUIVO falhou.
       O banco está como o arquivo deixou: cada migração deste projeto roda dentro da
       própria transação, então ou entrou inteira ou não entrou nada.
       As anteriores desta publicação já estão aplicadas e registradas.
       O app está PARADO. Corrija a migração, publique em staging e volte.
       Para voltar o app ao ar sem migrar:
         bash $0 $AMBIENTE --sem-migracoes --sem-build"
    fi
    MIGRACOES_APLICADAS=$((MIGRACOES_APLICADAS + 1))
    feito "$NOME_ARQUIVO aplicada e registrada"
  done
fi

if [ "$MEXER_NO_APP" = "nao" ]; then
  titulo "Pronto (só migrações)"
  nota "o app não foi tocado, como pedido com --so-migracoes"
else
  titulo "Subindo o app"
  compose up -d app
  ID_APP=""
  for _ in $(seq 1 30); do
    ID_APP="$(container_de "$PROJETO" app)"
    [ -n "$ID_APP" ] && break
    sleep 2
  done
  [ -n "$ID_APP" ] || morrer "o contêiner do app não subiu. Veja:
       docker compose -p $PROJETO --env-file $ARQUIVO_ENV -f $COMPOSE logs app"

  ESTADO_APP=""
  for _ in $(seq 1 60); do
    ESTADO_APP="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-healthcheck{{end}}' "$ID_APP" 2>/dev/null || echo desconhecido)"
    case "$ESTADO_APP" in healthy|sem-healthcheck) break ;; esac
    sleep 2
  done
  case "$ESTADO_APP" in
    healthy|sem-healthcheck) feito "app de pé ($ESTADO_APP)" ;;
    *) morrer "o app subiu mas não ficou saudável (estado: $ESTADO_APP).
       O /api/saude não respondeu. Veja:
         docker compose -p $PROJETO --env-file $ARQUIVO_ENV -f $COMPOSE logs app" ;;
  esac
  [ "$APP_PAROU" = "sim" ] && feito "app voltou ao ar depois da migração"
fi

# ---------------------------------------------------------------------------
# 9. Registro do que aconteceu
# ---------------------------------------------------------------------------

mkdir -p "$(dirname "$ARQUIVO_LOG")"
printf '%s ambiente=%s revisao=%s imagem=%s migracoes_aplicadas=%s backup=%s por=%s\n' \
  "$(date -Iseconds)" "$AMBIENTE" "$REVISAO" "$IMAGEM" "$MIGRACOES_APLICADAS" \
  "$FAZER_BACKUP" "$(id -un 2>/dev/null || echo desconhecido)" >> "$ARQUIVO_LOG"

titulo "Publicado"
cat <<FIM

  ambiente ............... $AMBIENTE
  revisão ................ $REVISAO
  migrações aplicadas .... $MIGRACOES_APLICADAS
  app .................... $URL_APP
  API .................... $URL_API
  registro ............... $ARQUIVO_LOG

  Confira de fora do servidor, do próprio tablet se der:
    - $URL_APP abre com cadeado (sem cadeado, o pareamento e o modo offline não funcionam)
    - $URL_API/rest/v1/ responde
    - a loja de teste carrega o cardápio

FIM
