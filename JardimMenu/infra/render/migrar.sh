#!/usr/bin/env bash
#
# Aplica as migrações pendentes do Jardim Menu DE DENTRO da rede do Render.
#
#   bash migrar.sh staging
#   bash migrar.sh producao
#
# POR QUE ESTE ARQUIVO EXISTE, se o infra/scripts/publicar.sh já migrava
#
# No servidor próprio o publicar.sh fazia tudo numa passada só: construía a imagem do app,
# subia a pilha, parava o app, migrava e devolvia o app. Ele chega ao banco por
# `docker exec` no contêiner db, e decide o que falta lendo o registro de publicação
# dentro dele.
#
# No Render nada disso existe:
#   - o banco é Private Service, SEM endereço público: ninguém migra de fora. Quem aplica
#     migração tem de estar dentro da rede privada do workspace, na mesma região;
#   - não há `docker exec`, não há contêiner para entrar, não há compose;
#   - o app não está mais no Render: ele é build estático + funções no Netlify. Não existe
#     `compose stop app`, então NÃO DÁ PARA TIRAR A LOJA DO AR enquanto o schema muda.
#     Isto não é detalhe — está escrito em voz alta no aviso de produção mais abaixo e no
#     infra/render/OPERACAO.md.
#
# O que este script MANTÉM do publicar.sh, porque é o que dá a garantia:
#   - o MESMO registro do que já foi aplicado (jardim_publicacao.migracoes, com o sha256
#     do arquivo), e a mesma escrita espelhada em supabase_migrations.schema_migrations;
#   - a MESMA trava do NF-012: produção recusa migração que não rodou em staging antes,
#     comparando versão E conteúdo. Não há opção de linha de comando que dispense isso;
#   - o backup antes de mexer no banco em produção (NF-011);
#   - a recusa de arquivo fora do padrão e de seed.sql na pasta de migrações.
#
# O que MUDA, e por quê:
#   - a trava de execução simultânea não é mais `flock` num arquivo. No Render cada
#     disparo é um contêiner novo com sistema de arquivos próprio: um flock ali não vê o
#     outro disparo e não protege nada. A trava passa a ser um advisory lock DO PRÓPRIO
#     POSTGRES, que é o único lugar que os dois enxergam. O Postgres solta a trava sozinho
#     quando a conexão morre, então não existe trava presa para alguém destravar na mão;
#   - as migrações vão todas pela MESMA sessão do psql, porque é a sessão que segura o
#     advisory lock. Cada arquivo continua abrindo e fechando a própria transação, e o
#     ON_ERROR_STOP=1 continua parando no primeiro erro;
#   - o registro do que aconteceu sai na saída padrão (é o log do Render), e não num
#     arquivo em disco: o disco do disparo morre com ele.
#
# COMO ELE É DISPARADO NO RENDER: está no infra/render/OPERACAO.md, seção "Migrar".
# Resumo: ele precisa de três coisas no lugar onde roda — o psql, os arquivos .sql de
# back/supabase/migrations, e as variáveis de conexão no ambiente.
#
# Configuração (as mesmas convenções do infra/backup): variáveis de ambiente
# <AMBIENTE_EM_MAIUSCULAS>_<SUFIXO>, vindas do ambiente do serviço no Render ou de um
# arquivo passado em --config (ou em JARDIM_MIGRAR_ENV):
#
#   PRODUCAO_PG_HOST=db-producao      # nome interno do Private Service do banco
#   PRODUCAO_PG_PORTA=5432
#   PRODUCAO_PG_USER=supabase_admin
#   PRODUCAO_PG_DB=postgres
#   PRODUCAO_PG_SENHA=...             # NUNCA em argumento de linha de comando
#   STAGING_PG_HOST=db-staging        # obrigatório para migrar PRODUÇÃO (NF-012)
#   ...
#
# Opções:
#   --config <arquivo>   configuração fora do ambiente (padrão: $JARDIM_MIGRAR_ENV)
#   --migracoes <dir>    pasta das migrações (padrão: <repo>/back/supabase/migrations)
#   --listar             só mostra o que falta e sai, sem tocar em nada
#   --sem-backup         pula o backup de produção. Só com --sim, e fica no registro
#   --revisao <texto>    identificação da revisão (padrão: RENDER_GIT_COMMIT, ou o git)
#   --sim                não pergunta nada
#   --ajuda
#
# NÃO existe opção para pular a checagem de staging. Se ela incomodar, o caminho é migrar
# o staging primeiro, que é o ponto.

set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Conversa com quem está rodando
#
# Tudo em stderr menos o que é dado. Na saída de um Cron Job ou de um one-off job do
# Render os dois se misturam de qualquer jeito, mas quem chamar `migrar.sh --listar` de
# dentro de outro script recebe só a lista.
# ---------------------------------------------------------------------------

titulo() { printf '\n== %s\n' "$*" >&2; }
feito()  { printf '   ok    %s\n' "$*" >&2; }
nota()   { printf '         %s\n' "$*" >&2; }
aviso()  { printf '   ATENCAO %s\n' "$*" >&2; }
morrer() { printf '\nMIGRACAO INTERROMPIDA: %s\n\n' "$*" >&2; exit 1; }

# A ajuda é o cabeçalho deste arquivo, do início até a primeira linha que não é
# comentário. Sem número de linha, não há o que desatualizar (mesma solução do
# publicar.sh, que já tinha sido mordido por um `sed -n '2,45p'` fixo).
ajuda() { sed -n '2,${/^#/!q;p;}' "$0" | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------------------
# Onde estão as coisas
# ---------------------------------------------------------------------------

DIR_SCRIPT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DIR_INFRA="$(cd -- "$DIR_SCRIPT/.." && pwd)"
DIR_JARDIM="$(cd -- "$DIR_INFRA/.." && pwd)"

# ---------------------------------------------------------------------------
# Opções
# ---------------------------------------------------------------------------

AMBIENTE="${1:-}"
case "$AMBIENTE" in
  -h|--ajuda|--help) ajuda; exit 0 ;;
  '') morrer "uso: bash migrar.sh <ambiente> [opções] (--ajuda mostra o resto)" ;;
  -*) morrer "o primeiro argumento é o ambiente, não uma opção: bash migrar.sh <ambiente> ..." ;;
  *) shift ;;
esac

ARQUIVO_CONFIG="${JARDIM_MIGRAR_ENV:-}"
DIR_MIGRACOES="${DIR_MIGRACOES:-}"
SO_LISTAR=nao
FAZER_BACKUP=padrao
PERGUNTAR=sim
REVISAO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --config)     ARQUIVO_CONFIG="${2:?--config exige um arquivo}"; shift 2 ;;
    --migracoes)  DIR_MIGRACOES="${2:?--migracoes exige uma pasta}"; shift 2 ;;
    --listar)     SO_LISTAR=sim; shift ;;
    --sem-backup) FAZER_BACKUP=nao; shift ;;
    --revisao)    REVISAO="${2:?--revisao exige um texto}"; shift 2 ;;
    --sim)        PERGUNTAR=nao; shift ;;
    -h|--ajuda|--help) ajuda; exit 0 ;;
    *) morrer "opção desconhecida: $1" ;;
  esac
done

# Mesma regra do publicar.sh: pular o backup de produção é escolha deliberada de quem está
# olhando, e não efeito colateral de um script chamando outro sem ninguém por perto.
if [ "$FAZER_BACKUP" = "nao" ] && [ "$PERGUNTAR" = "sim" ]; then
  morrer "--sem-backup só vale junto de --sim. Pular o backup de produção é decisão de quem
       está lendo isto, não de quem copiou o comando."
fi

# ---------------------------------------------------------------------------
# Configuração
#
# `source` num arquivo de configuração é o que o infra/backup já faz, e o arquivo mora
# fora do git com 600. Aqui ele é opcional: no Render o normal é as variáveis virem do
# ambiente do serviço, e nenhum arquivo existir.
# ---------------------------------------------------------------------------

if [ -n "$ARQUIVO_CONFIG" ]; then
  [ -r "$ARQUIVO_CONFIG" ] || morrer "não consigo ler a configuração $ARQUIVO_CONFIG"
  MODO_CONFIG="$(stat -c '%a' "$ARQUIVO_CONFIG" 2>/dev/null || echo '600')"
  [ "${MODO_CONFIG: -2}" = "00" ] || aviso "$ARQUIVO_CONFIG está $MODO_CONFIG e tem senha de banco (chmod 600)."
  set -a
  # shellcheck disable=SC1090
  . "$ARQUIVO_CONFIG"
  set +a
fi

# Quais nomes de ambiente são produção de verdade. É lista, e não a palavra "producao"
# escrita no código, porque o projeto convida a criar ambiente novo e a trava do NF-012
# precisa acompanhar (o restaurar.sh já resolve assim).
AMBIENTES_PRODUCAO="${AMBIENTES_PRODUCAO:-producao}"
# Qual ambiente é o staging que a trava do NF-012 consulta.
AMBIENTE_STAGING="${AMBIENTE_STAGING:-staging}"
# Segundos de paciência para ABRIR a conexão. Sem isto, um nome interno errado deixa o
# disparo pendurado até o teto de 12h do Cron Job do Render, e ninguém descobre o motivo.
PGCONNECT_TIMEOUT="${PG_TIMEOUT_CONEXAO:-15}"
export PGCONNECT_TIMEOUT
BACKUP_SH="${BACKUP_SH:-$DIR_INFRA/backup/backup.sh}"

validar_ambiente() {
  printf '%s' "$1" | grep -Eq '^[a-z][a-z0-9_-]*$' \
    || morrer "nome de ambiente inválido: '$1' (minúsculas, dígitos, - e _)."
}
validar_ambiente "$AMBIENTE"
validar_ambiente "$AMBIENTE_STAGING"

EH_PRODUCAO=nao
for _amb in $AMBIENTES_PRODUCAO; do
  validar_ambiente "$_amb"
  # if/fi e não `[ ... ] && x`: com set -e, um AND-OR que falha como ÚLTIMO comando do
  # laço pode derrubar a rodada. O verificar.sh do monitoramento já levou essa mordida.
  if [ "$AMBIENTE" = "$_amb" ]; then EH_PRODUCAO=sim; fi
done

# Valor de uma variável por ambiente: <AMBIENTE_EM_MAIUSCULAS>_<SUFIXO>. Mesma convenção
# do infra/backup/lib/comum.sh, de propósito: quem já configurou o backup no Render
# reaproveita os mesmos nomes.
var_do_ambiente() {
  local amb="$1" sufixo="$2" padrao="${3-}" nome
  nome="${amb^^}_${sufixo}"
  nome="${nome//-/_}"
  printf '%s' "${!nome:-$padrao}"
}

# ---------------------------------------------------------------------------
# Falar com o Postgres
#
# A senha vai por PGPASSWORD, no ambiente, e NUNCA em argumento: argumento aparece no
# `ps` de qualquer processo da máquina, e segredo em linha de comando é proibido neste
# projeto. Quem lê o ambiente de um processo é o dono dele ou o root, que já teriam tudo.
# ---------------------------------------------------------------------------

psql_no() {
  local amb="$1"; shift
  local host porta user db senha
  host="$(var_do_ambiente "$amb" PG_HOST "")"
  porta="$(var_do_ambiente "$amb" PG_PORTA "5432")"
  # supabase_admin, e não postgres: os schemas auth e storage pertencem a ele. É a mesma
  # escolha (e o mesmo defeito de 23/09/2026) que está explicada no infra/backup.
  user="$(var_do_ambiente "$amb" PG_USER "${PG_USER:-supabase_admin}")"
  db="$(var_do_ambiente "$amb" PG_DB "${PG_DB:-postgres}")"
  senha="$(var_do_ambiente "$amb" PG_SENHA "")"
  PGPASSWORD="$senha" psql -v ON_ERROR_STOP=1 \
    -h "$host" -p "$porta" -U "$user" -d "$db" "$@"
}

descricao_de() {
  local amb="$1"
  printf '%s:%s/%s como %s' \
    "$(var_do_ambiente "$amb" PG_HOST "")" \
    "$(var_do_ambiente "$amb" PG_PORTA "5432")" \
    "$(var_do_ambiente "$amb" PG_DB "${PG_DB:-postgres}")" \
    "$(var_do_ambiente "$amb" PG_USER "${PG_USER:-supabase_admin}")"
}

exigir_conexao() {
  # $1 ambiente, $2 para que serve (aparece na mensagem de erro).
  local amb="$1" para="$2" host senha
  host="$(var_do_ambiente "$amb" PG_HOST "")"
  senha="$(var_do_ambiente "$amb" PG_SENHA "")"
  [ -n "$host" ] || morrer "${amb^^}_PG_HOST está vazia, e ela é $para.
       No Render esse valor é o NOME INTERNO do Private Service do banco daquele
       ambiente (ele não tem endereço público). Veja infra/render/OPERACAO.md."
  [ -n "$senha" ] || morrer "${amb^^}_PG_SENHA está vazia, e ela é $para."
  psql_no "$amb" -Atqc 'select 1' >/dev/null 2>&1 || morrer \
    "não consegui falar com o banco de '$amb' ($(descricao_de "$amb")).
       As três causas, em ordem de frequência no Render:
         1. o nome interno está errado, ou o serviço está em OUTRA região/workspace —
            a rede privada só liga serviços da mesma região do mesmo workspace;
         2. a senha de ${amb^^}_PG_SENHA não é a daquele banco;
         3. o banco ainda está subindo (o disco é grande, o initdb demora)."
}

# ---------------------------------------------------------------------------
# 1. Conferências que não dependem de banco nenhum
# ---------------------------------------------------------------------------

titulo "Conferências"

command -v psql >/dev/null 2>&1 || morrer \
  "psql não existe aqui dentro. Este script roda DENTRO da rede do Render, num lugar que
       tenha o cliente do Postgres: a imagem do próprio banco tem, uma imagem magra pode
       não ter. Veja infra/render/OPERACAO.md, seção 'Migrar'."

DIR_MIGRACOES="${DIR_MIGRACOES:-$DIR_JARDIM/back/supabase/migrations}"
[ -d "$DIR_MIGRACOES" ] || morrer \
  "não achei a pasta de migrações em $DIR_MIGRACOES.
       Ela precisa chegar ao lugar onde este script roda (a imagem que o Render constrói
       não traz back/supabase por acidente). Aponte com --migracoes, ou veja o
       infra/render/OPERACAO.md."

# Massa de desenvolvimento nunca sai da máquina de quem programa: o seed.sql tem usuário e
# senha fictícios e existe só para o `supabase db reset`.
if [ -f "$DIR_MIGRACOES/seed.sql" ]; then
  morrer "há um seed.sql dentro de $DIR_MIGRACOES. Massa de desenvolvimento não sobe para
       ambiente nenhum. Tire o arquivo de lá."
fi

# A pasta de migrações só pode ter migração: qualquer outro .sql aqui viraria parte da
# migração sem ninguém ter decidido isso.
MIGRACOES=()
while IFS= read -r CAMINHO; do
  NOME_ARQUIVO="$(basename "$CAMINHO")"
  case "$NOME_ARQUIVO" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql) ;;
    *) morrer "arquivo fora do padrão em $DIR_MIGRACOES: $NOME_ARQUIVO
       O nome precisa ser <14 dígitos>_<nome>.sql, como o Supabase gera." ;;
  esac
  # O `*` do padrão acima aceita QUALQUER coisa depois do `_`, inclusive aspas simples. E o
  # nome do arquivo é interpolado dentro de um literal SQL no passo 6
  # (`values ('...', '<arquivo>', ...)`). Um `20260101000000_it's.sql` fecharia o literal:
  # a migração rodaria (ela vem antes, e commita sozinha) e o INSERT do registro morreria
  # em erro de sintaxe. Resultado: schema mudado e NÃO registrado — na próxima rodada a
  # mesma migração é vista como pendente e aplicada de novo, em cima de si mesma. É
  # exatamente a falha silenciosa que este projeto não aceita, e sai barato recusar antes.
  case "$NOME_ARQUIVO" in
    *[!A-Za-z0-9._-]*) morrer "nome de migração com caractere que não serve: $NOME_ARQUIVO
       Use só letras, dígitos, ponto, hífen e sublinhado. O nome vai para dentro de um
       literal SQL no registro de publicação, e aspas ali quebram o registro DEPOIS de a
       migração já ter rodado." ;;
  esac
  MIGRACOES+=("$CAMINHO")
done < <(find "$DIR_MIGRACOES" -maxdepth 1 -type f -name '*.sql' | sort)
[ "${#MIGRACOES[@]}" -gt 0 ] || morrer "nenhuma migração em $DIR_MIGRACOES"
feito "${#MIGRACOES[@]} migrações na pasta"

# A revisão publicada. No Render não há checkout git dentro do contêiner, mas há
# RENDER_GIT_COMMIT no ambiente de todo serviço construído a partir do repositório — é ele
# que diz qual código gerou esta imagem. O git fica como terceira opção, para quem rodar
# isto de uma máquina com o repositório em mãos.
if [ -z "$REVISAO" ]; then
  REVISAO="${JM_REVISAO:-${RENDER_GIT_COMMIT:-}}"
fi
if [ -z "$REVISAO" ] && git -C "$DIR_JARDIM" rev-parse --git-dir >/dev/null 2>&1; then
  REVISAO="$(git -C "$DIR_JARDIM" rev-parse --short HEAD)"
  if [ -n "$(git -C "$DIR_JARDIM" status --porcelain)" ]; then REVISAO="$REVISAO-sujo"; fi
fi
REVISAO="$(printf '%s' "${REVISAO:-sem-revisao}" | tr -cd 'A-Za-z0-9._-')"
REVISAO="${REVISAO:-sem-revisao}"
feito "revisão $REVISAO"

exigir_conexao "$AMBIENTE" "o banco que vai receber as migrações"
feito "banco de $AMBIENTE responde ($(descricao_de "$AMBIENTE"))"

# ---------------------------------------------------------------------------
# 2. O registro do que já foi aplicado
#
# Mesmo schema, mesma tabela e mesmas colunas do infra/scripts/publicar.sh, de propósito:
# um ambiente que já foi migrado pelo publicar.sh no servidor próprio e depois migrado por
# aqui continua com UM registro só, e o sha256 continua servindo de prova entre os dois
# ambientes. Mudar o formato aqui quebraria a trava do NF-012 na travessia.
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
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL
)

titulo "Migrações"

printf '%s\n' "$SQL_REGISTRO" | psql_no "$AMBIENTE" -q >/dev/null \
  || morrer "não consegui criar/conferir o registro de publicação em $AMBIENTE.
       O papel ${AMBIENTE^^}_PG_USER precisa poder criar schema neste banco."
feito "registro de publicação pronto"

sha_de() { sha256sum "$1" | cut -d' ' -f1; }

versoes_aplicadas() {
  # $1 ambiente. Uma linha por migração: "<versao> <sha256>".
  psql_no "$1" -Atq -c \
    "select versao || ' ' || sha256 from jardim_publicacao.migracoes order by versao"
}

APLICADAS_AQUI="$(psql_no "$AMBIENTE" -Atq -c 'select versao from jardim_publicacao.migracoes')"

PENDENTES=()
for CAMINHO in "${MIGRACOES[@]}"; do
  VERSAO="$(basename "$CAMINHO" | cut -d_ -f1)"
  if printf '%s\n' "$APLICADAS_AQUI" | grep -qxF "$VERSAO"; then continue; fi
  PENDENTES+=("$CAMINHO")
done

if [ "${#PENDENTES[@]}" -eq 0 ]; then
  feito "nenhuma migração pendente em $AMBIENTE"
else
  feito "${#PENDENTES[@]} pendente(s) em $AMBIENTE:"
  for CAMINHO in "${PENDENTES[@]}"; do nota "- $(basename "$CAMINHO")"; done
fi

if [ "$SO_LISTAR" = "sim" ]; then
  # Só aqui o stdout carrega dado: uma linha por migração pendente, para quem quiser
  # encadear. Sem pendência, não sai nada e o código de saída continua 0.
  for CAMINHO in "${PENDENTES[@]}"; do basename "$CAMINHO"; done
  exit 0
fi

if [ "${#PENDENTES[@]}" -eq 0 ]; then
  titulo "Nada a fazer"
  printf 'resultado=ok ambiente=%s revisao=%s migracoes_aplicadas=0 backup=nao-precisou\n' \
    "$AMBIENTE" "$REVISAO"
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. A recusa (NF-012): produção não recebe migração que staging não recebeu
#
# Comparamos versão E sha256 do arquivo. Versão igual com conteúdo diferente significa que
# alguém editou a migração depois de ela ter rodado em staging, e então o que seria
# aplicado em produção nunca foi exercitado em lugar nenhum. É a mesma checagem do
# publicar.sh, lendo o mesmo registro — e, como lá, não há opção que a desligue.
#
# A diferença do Render: para ler o registro do staging, este disparo precisa ALCANÇAR o
# banco de staging. A rede privada liga serviços da MESMA região e do MESMO workspace. Se
# staging e produção ficarem separados por região ou workspace, esta checagem não tem como
# rodar — e então a migração de produção para aqui, porque o NF-012 não é opcional.
# ---------------------------------------------------------------------------

if [ "$EH_PRODUCAO" = "sim" ]; then
  titulo "Conferindo o staging"

  [ "$(var_do_ambiente "$AMBIENTE_STAGING" PG_HOST "")" != "" ] || morrer \
    "${AMBIENTE_STAGING^^}_PG_HOST não está configurada.
       Produção não recebe migração que não passou por staging (NF-012), e sem o endereço
       do banco de staging não há como conferir. No Render isso quer dizer: o serviço que
       dispara esta migração precisa ter, no ambiente dele, os dados de conexão DOS DOIS
       bancos, e os dois precisam estar na mesma região e no mesmo workspace."
  exigir_conexao "$AMBIENTE_STAGING" "de onde sai a prova do NF-012"

  APLICADAS_STAGING="$(versoes_aplicadas "$AMBIENTE_STAGING")" || morrer \
    "não consegui ler o registro de publicação do staging.
       Ele já foi migrado alguma vez? Rode antes:
         bash $0 $AMBIENTE_STAGING"

  FALTOU=0
  for CAMINHO in "${PENDENTES[@]}"; do
    NOME_ARQUIVO="$(basename "$CAMINHO")"
    VERSAO="${NOME_ARQUIVO%%_*}"
    SHA="$(sha_de "$CAMINHO")"
    SHA_STAGING="$(printf '%s\n' "$APLICADAS_STAGING" | awk -v v="$VERSAO" '$1 == v {print $2; exit}')"
    if [ -z "$SHA_STAGING" ]; then
      printf '   NAO RODOU EM STAGING   %s\n' "$NOME_ARQUIVO" >&2
      FALTOU=$((FALTOU + 1))
    elif [ "$SHA_STAGING" != "$SHA" ]; then
      printf '   MUDOU DEPOIS DO STAGING %s\n' "$NOME_ARQUIVO" >&2
      nota "  staging rodou o arquivo com sha256 $SHA_STAGING"
      nota "  aqui o arquivo está com     sha256 $SHA"
      FALTOU=$((FALTOU + 1))
    else
      feito "$NOME_ARQUIVO já rodou em staging, com o mesmo conteúdo"
    fi
  done

  [ "$FALTOU" -eq 0 ] || morrer \
    "$FALTOU migração(ões) não passaram por staging.
       Migre o staging, confira que a loja de teste continua funcionando, e só então
       volte aqui:
         bash $0 $AMBIENTE_STAGING
       Esta checagem não tem como ser desligada, de propósito (NF-012)."
fi

# ---------------------------------------------------------------------------
# 4. O aviso de produção
#
# No servidor próprio o publicar.sh PARAVA o app antes de migrar, e essa era a proteção
# contra um pedido morrer no meio porque a coluna mudou embaixo dele. No Render/Netlify
# não existe equivalente: o front continua servindo e as funções continuam chamando o
# banco enquanto o schema muda. A única proteção que sobrou é o horário.
# ---------------------------------------------------------------------------

if [ "$EH_PRODUCAO" = "sim" ] && [ "$PERGUNTAR" = "sim" ]; then
  # Cron Job e one-off job do Render rodam SEM terminal: a entrada padrão já vem fechada.
  # Um `read -r` ali devolve vazio na hora, a resposta nunca bate com o nome do ambiente e
  # a migração morre dizendo "não confirmado" — mensagem que manda o operador procurar um
  # prompt que nunca existiu. Falhar é o certo (ninguém confirmou nada), mas dizendo o quê.
  if [ ! -t 0 ]; then
    morrer "produção exige confirmação, e aqui não há terminal para digitá-la.
       No Render (Cron Job ou one-off job) a entrada padrão vem fechada, então a pergunta
       não tem como ser feita. Quem decide passa --sim no comando de início:
         bash migrar.sh $AMBIENTE --sim
       Ao passar --sim você está afirmando o que a pergunta afirmaria: que A CASA ESTÁ
       FECHADA. O app no Netlify NÃO para enquanto o schema muda — o tablet pode enviar
       pedido no instante em que uma coluna deixa de existir (JM-187)."
  fi
  titulo "Produção"
  {
    printf '  Isto mexe no banco que a loja usa de verdade:\n\n'
    printf '    banco .......... %s\n' "$(descricao_de "$AMBIENTE")"
    printf '    revisão ........ %s\n' "$REVISAO"
    printf '    migrações ...... %s\n\n' "${#PENDENTES[@]}"
    printf '  E O APP NAO PARA. No servidor próprio a publicação tirava o app do ar\n'
    printf '  enquanto o schema mudava; no Netlify não há como fazer isso. O tablet pode\n'
    printf '  enviar pedido no exato instante em que uma coluna deixa de existir, e quem\n'
    printf '  vê o erro é o cliente, na mesa (JM-187).\n\n'
    printf '  FAÇA ISTO COM A CASA FECHADA.\n\n'
    printf '  Digite %s para seguir: ' "$AMBIENTE"
  } >&2
  read -r RESPOSTA
  [ "$RESPOSTA" = "$AMBIENTE" ] || morrer "não confirmado, nada foi alterado"
fi

# ---------------------------------------------------------------------------
# 5. Backup antes de mexer no banco (NF-011)
# ---------------------------------------------------------------------------

BACKUP_FEITO=nao-pedido
if [ "$EH_PRODUCAO" = "sim" ]; then
  if [ "$FAZER_BACKUP" = "nao" ]; then
    aviso "backup pulado por --sem-backup. Vai ficar no registro desta rodada."
    BACKUP_FEITO=pulado
  else
    titulo "Backup antes da migração"
    [ -f "$BACKUP_SH" ] || morrer \
      "não achei o backup.sh em $BACKUP_SH, e produção não migra sem backup (NF-011).
       No Render ele precisa estar no mesmo lugar que este script, configurado com
       MODO_BANCO=host (veja infra/render/OPERACAO.md). Aponte com a variável BACKUP_SH,
       ou assuma a responsabilidade com --sem-backup --sim."
    # --somente-banco de propósito: o que a migração pode estragar é o banco. As fotos
    # ficam para a rodada diária, que é onde elas já são tratadas.
    bash "$BACKUP_SH" --ambiente "$AMBIENTE" --somente-banco \
      || morrer "o backup falhou, e produção não migra sem backup (NF-011)."
    BACKUP_FEITO=sim
    feito "backup do banco guardado antes de migrar"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Aplicar
#
# Tudo numa sessão só do psql, e a razão é a trava.
#
# No servidor próprio o publicar.sh garantia uma publicação de cada vez com `flock` num
# arquivo do disco: os dois operadores estavam na MESMA máquina, e o arquivo era o mesmo.
# No Render cada disparo (Cron Job, one-off job, sessão de SSH) é um contêiner novo, com
# sistema de arquivos próprio: um flock ali não enxerga o outro disparo e daria uma falsa
# sensação de proteção. Duas migrações ao mesmo tempo intercalam o laço, e o
# `on conflict do nothing` do registro esconde a segunda passagem — fica parecendo que
# rodou tudo.
#
# O único lugar que os dois disparos enxergam é o próprio banco. Daí o advisory lock: ele
# é de SESSÃO, então precisa de uma sessão que dure a migração inteira; e o Postgres o
# solta sozinho quando a conexão morre, o que quer dizer que não existe trava presa para
# alguém ter de destravar na mão depois de um disparo interrompido.
#
# Cada arquivo continua abrindo e fechando a própria transação (begin;/commit; dentro do
# arquivo), então NÃO usamos --single-transaction: seria transação dentro de transação, e
# o commit do arquivo fecharia a nossa no meio. O ON_ERROR_STOP=1 é que garante a parada
# no primeiro erro — e, como cada arquivo commita sozinho, o que entrou antes do erro fica
# aplicado E registrado, que é exatamente o comportamento do publicar.sh.
# ---------------------------------------------------------------------------

titulo "Aplicando migrações"

QUEM="${RENDER_SERVICE_NAME:-$(id -un 2>/dev/null || echo desconhecido)}@${RENDER_INSTANCE_ID:-${HOSTNAME:-render}}"
QUEM="$(printf '%s' "$QUEM" | tr -cd 'A-Za-z0-9@._-')"
QUEM="${QUEM:-desconhecido}"

# A chave do advisory lock é fixa e nasce de um texto: qualquer disparo deste script, de
# qualquer imagem, calcula a mesma. hashtext é interno do Postgres e estável dentro de uma
# versão maior — e os dois lados aqui são sempre o MESMO banco, então basta que ele
# concorde consigo mesmo.
SQL_TRAVA="do \$jm\$
begin
  if not pg_try_advisory_lock(hashtext('jardim_menu:migracao')) then
    raise exception 'ja existe uma migracao rodando neste banco (advisory lock tomado). Espere ela terminar.';
  end if;
end
\$jm\$;"

montar_lote() {
  # Escreve na saída padrão o SQL da rodada inteira: trava, e depois cada migração
  # seguida do próprio registro.
  printf '%s\n' "$SQL_TRAVA"
  local caminho nome versao curto sha
  for caminho in "${PENDENTES[@]}"; do
    nome="$(basename "$caminho")"
    versao="${nome%%_*}"
    curto="${nome#*_}"; curto="${curto%.sql}"
    sha="$(sha_de "$caminho")"
    printf '\\echo >>> aplicando %s\n' "$nome"
    cat "$caminho"
    printf '\n'
    # O registro vai logo depois, na mesma sessão e fora da transação do arquivo. Se a
    # migração passar e o registro falhar (praticamente impossível: é um insert em tabela
    # nossa), o ON_ERROR_STOP para aqui e o passo 7 mostra exatamente o que entrou.
    printf "insert into jardim_publicacao.migracoes (versao, arquivo, sha256, aplicada_por, revisao_git)\n"
    printf "values ('%s', '%s', '%s', '%s', '%s')\n" "$versao" "$nome" "$sha" "$QUEM" "$REVISAO"
    printf "on conflict (versao) do nothing;\n"
    printf "insert into supabase_migrations.schema_migrations (version, name)\n"
    printf "values ('%s', '%s')\n" "$versao" "$curto"
    printf "on conflict (version) do nothing;\n"
    printf '\\echo <<< aplicada %s\n' "$nome"
  done
}

# Sinal no meio da migração. Não há app para devolver ao ar (ele nunca saiu), mas há uma
# coisa a fazer: dizer alto que o banco pode ter ficado no meio do caminho e deixar isso
# no log do Render. HUP é o que chega quando a sessão de SSH cai, que é o caminho mais
# provável de todos; TERM é o que o Render manda quando alguém cancela o disparo.
#
# Os traps só são instalados AQUI, e não no topo: antes deste ponto nada foi escrito no
# banco, e uma interrupção ali não tem consequência nenhuma para explicar.
ao_receber_sinal() {
  local sinal="$1"
  set +e
  trap '' HUP INT TERM
  {
    printf '\nA MIGRACAO FOI INTERROMPIDA (%s).\n' "$sinal"
    printf '   O banco pode ter ficado no meio do caminho: as migrações que já commitaram\n'
    printf '   estão aplicadas E registradas, e a que estava rodando não entrou.\n'
    printf '   Veja onde parou, sem tocar em nada:\n'
    printf '     bash %s %s --listar\n\n' "$0" "$AMBIENTE"
  } >&2
  printf 'resultado=interrompida:%s ambiente=%s revisao=%s backup=%s por=%s\n' \
    "$sinal" "$AMBIENTE" "$REVISAO" "$BACKUP_FEITO" "$QUEM"
  exit 130
}
trap 'ao_receber_sinal sinal-HUP' HUP
trap 'ao_receber_sinal sinal-INT' INT
trap 'ao_receber_sinal sinal-TERM' TERM

ESTADO_LOTE=0
montar_lote | psql_no "$AMBIENTE" -q >&2 || ESTADO_LOTE=$?

trap - HUP INT TERM

# ---------------------------------------------------------------------------
# 7. O que REALMENTE entrou
#
# Perguntamos ao banco, em vez de contar o que mandamos. É a diferença entre relatar o
# que aconteceu e relatar o que se pretendia: numa rodada interrompida no meio, é esta
# lista que diz onde o banco parou.
# ---------------------------------------------------------------------------

APLICADAS_DEPOIS="$(psql_no "$AMBIENTE" -Atq -c 'select versao from jardim_publicacao.migracoes' 2>/dev/null || true)"
QUANTAS=0
for CAMINHO in "${PENDENTES[@]}"; do
  VERSAO="$(basename "$CAMINHO" | cut -d_ -f1)"
  if printf '%s\n' "$APLICADAS_DEPOIS" | grep -qxF "$VERSAO"; then
    QUANTAS=$((QUANTAS + 1))
  fi
done

if [ "$ESTADO_LOTE" -ne 0 ]; then
  printf 'resultado=falhou ambiente=%s revisao=%s migracoes_aplicadas=%s de=%s backup=%s por=%s\n' \
    "$AMBIENTE" "$REVISAO" "$QUANTAS" "${#PENDENTES[@]}" "$BACKUP_FEITO" "$QUEM"
  # Duas mensagens diferentes, porque são duas situações muito diferentes, e tratá-las
  # igual mandaria alguém correr para conferir a loja quando nada foi tocado. Zero
  # aplicadas quer dizer que a parada foi ANTES da primeira migração: quase sempre é a
  # trava (outro disparo migrando agora) ou permissão.
  if [ "$QUANTAS" -eq 0 ]; then
    morrer "a migração parou antes de aplicar qualquer coisa (psql saiu com $ESTADO_LOTE).
       NADA foi alterado no banco. A mensagem do psql, logo acima, diz o motivo — as duas
       causas comuns são: já existe outra migração rodando neste banco (o advisory lock
       está tomado), ou o papel ${AMBIENTE^^}_PG_USER não pode fazer o que a migração pede."
  fi
  morrer "a migração parou no meio (psql saiu com $ESTADO_LOTE).
       $QUANTAS de ${#PENDENTES[@]} migrações desta rodada entraram e estão registradas;
       o resto não. Cada migração deste projeto roda dentro da própria transação, então
       a que falhou ou entrou inteira ou não entrou nada.
       O APP CONTINUA NO AR, agora sobre um banco que ficou no meio do caminho: confira a
       loja antes de qualquer outra coisa.
       Corrija a migração, passe pelo staging e volte."
fi

# O psql saiu 0, mas o banco discorda da conta: menos migrações registradas do que esta
# rodada mandou aplicar. Não deveria acontecer nunca — e é justamente por isso que sair
# daqui com "resultado=ok migracoes_aplicadas=0 de=2" seria o pior desfecho possível:
# alguém lê "ok" no log do Render e vai embora, com o schema num estado que ninguém
# conferiu. Quando o relato não fecha com o banco, quem manda é o banco, e isto é falha.
if [ "$QUANTAS" -ne "${#PENDENTES[@]}" ]; then
  printf 'resultado=falhou:conta-nao-fecha ambiente=%s revisao=%s migracoes_aplicadas=%s de=%s backup=%s por=%s\n' \
    "$AMBIENTE" "$REVISAO" "$QUANTAS" "${#PENDENTES[@]}" "$BACKUP_FEITO" "$QUEM"
  morrer "o psql terminou sem erro, mas o registro do banco só tem $QUANTAS das
       ${#PENDENTES[@]} migrações desta rodada. As duas coisas não podem ser verdade ao
       mesmo tempo, então não dá para chamar isto de publicação bem-sucedida.
       Veja o que o banco diz, sem tocar em nada:
         bash $0 $AMBIENTE --listar
       E confira a loja antes de qualquer outra coisa: o app no Netlify continuou no ar
       o tempo todo, agora sobre um banco em estado que ninguém confirmou."
fi

titulo "Migrado"
{
  printf '\n'
  printf '  ambiente ............... %s\n' "$AMBIENTE"
  printf '  banco .................. %s\n' "$(descricao_de "$AMBIENTE")"
  printf '  revisão ................ %s\n' "$REVISAO"
  printf '  migrações aplicadas .... %s\n' "$QUANTAS"
  printf '  backup antes ........... %s\n' "$BACKUP_FEITO"
  printf '\n'
  printf '  Confira agora, de fora: a loja abre, o cardápio carrega e um pedido de teste\n'
  printf '  chega à tela da equipe. O monitoramento avisa que caiu, não que mudou.\n\n'
} >&2

# A linha do registro sai no stdout e é a última coisa impressa: é ela que fica no log do
# Render e é ela que se procura depois. Mesmos campos da linha do publicar.sh, para os
# dois registros serem lidos do mesmo jeito.
printf 'resultado=ok ambiente=%s revisao=%s migracoes_aplicadas=%s de=%s backup=%s por=%s\n' \
  "$AMBIENTE" "$REVISAO" "$QUANTAS" "${#PENDENTES[@]}" "$BACKUP_FEITO" "$QUEM"

exit 0
