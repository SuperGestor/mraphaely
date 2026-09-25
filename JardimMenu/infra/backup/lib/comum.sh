# shellcheck shell=bash
# Funções comuns do backup e da restauração do Jardim Menu (NF-011).
#
# Este arquivo é carregado com `source`, não é executado sozinho, e por isso não
# tem shebang nem `set -e`: quem manda no comportamento de erro é o script que
# carrega. A duplicação com infra/monitoramento/lib/comum.sh é deliberada, para
# que cada pasta possa ser copiada para o servidor sozinha, sem dependência
# cruzada.

# ---------------------------------------------------------------- log

# Carimbo de tempo com fuso explícito. O servidor deve estar em
# America/Sao_Paulo (ver README), mas o registro diz o fuso mesmo assim, para
# que um log lido meses depois não deixe dúvida sobre o horário.
jm_agora() {
  date '+%Y-%m-%d %H:%M:%S %z'
}

# stderr, junto do aviso e do erro. Registro não é dado: enquanto o registro saía no
# stdout, qualquer função que devolvesse valor por stdout entregava o registro grudado no
# valor. Foi o que quebrou o `restaurar.sh --do-remoto`: o caminho do arquivo baixado
# voltava com a linha "Baixando ... do destino externo" na frente, e o pg_restore procurava
# um arquivo com esse nome. Quem captura tudo não perde nada: o backup.sh manda stdout e
# stderr para o mesmo tee.
jm_log() {
  printf '[%s] %s\n' "$(jm_agora)" "$*" >&2
}

jm_aviso() {
  printf '[%s] AVISO: %s\n' "$(jm_agora)" "$*" >&2
}

jm_erro() {
  printf '[%s] ERRO: %s\n' "$(jm_agora)" "$*" >&2
}

# ---------------------------------------------------------------- Telegram

# Aviso no Telegram. O canal foi escolhido pelo PO em 22/09/2026 e atende o
# NF-009 (registro de erro com alerta em canal nomeado) do lado da operação.
#
# Regras deste envio:
#  - sem token configurado, só registra no log e segue; backup sem Telegram
#    ainda é backup, e derrubar a rotina por causa do aviso seria pior;
#  - o token nunca aparece no log, nem em caso de erro do curl;
#  - falha de envio nunca derruba quem chamou (o `|| true` fica aqui dentro).
jm_telegram() {
  local texto="$1"
  local token="${ALERT_TELEGRAM_BOT_TOKEN:-}"
  local chat="${ALERT_TELEGRAM_CHAT_ID:-}"

  if [ -z "$token" ] || [ -z "$chat" ]; then
    jm_aviso "Telegram não configurado (ALERT_TELEGRAM_BOT_TOKEN/ALERT_TELEGRAM_CHAT_ID). Aviso só no log."
    jm_log "AVISO QUE SERIA ENVIADO: $texto"
    return 0
  fi

  local http
  http="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
    -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=${chat}" \
    --data-urlencode "text=${texto}" \
    --data-urlencode "disable_web_page_preview=true" 2>/dev/null)" || http="000"

  if [ "$http" = "200" ]; then
    jm_log "Aviso enviado ao Telegram."
  else
    # Não repetimos o corpo da resposta: ela pode ecoar a URL, e a URL tem o token.
    jm_aviso "Telegram respondeu HTTP ${http}; o aviso não chegou. Confira o token e o chat_id."
  fi
  return 0
}

# ---------------------------------------------------------------- configuração

# Carrega um arquivo de configuração exportando tudo que ele define.
# O arquivo mora FORA do git (padrão: /etc/jardim-menu/backup.env), porque tem
# senha de banco e token de bot.
jm_carregar_config() {
  local arquivo="$1"
  if [ ! -r "$arquivo" ]; then
    jm_erro "Configuração não encontrada ou sem permissão de leitura: $arquivo"
    jm_erro "Copie infra/backup/exemplo/backup.env.exemplo para lá e preencha."
    return 1
  fi
  # Um arquivo com senha não pode estar legível para grupo nem para outros:
  # os dois últimos dígitos da permissão têm de ser zero.
  local modo
  modo="$(stat -c '%a' "$arquivo" 2>/dev/null || echo '600')"
  if [ "${modo: -2}" != "00" ]; then
    jm_aviso "Permissão $modo em $arquivo, e ele tem senha. Rode: chmod 600 $arquivo"
  fi
  set -a
  # shellcheck disable=SC1090
  . "$arquivo"
  set +a
}

# Valor de uma variável por ambiente. O nome segue o padrão
# <AMBIENTE_EM_MAIUSCULAS>_<SUFIXO>, por exemplo PRODUCAO_CONTAINER_DB.
# Assim a lista de ambientes é dado de configuração, e não código.
jm_var_ambiente() {
  local ambiente="$1" sufixo="$2" padrao="${3-}"
  local nome="${ambiente^^}_${sufixo}"
  nome="${nome//-/_}"
  printf '%s' "${!nome:-$padrao}"
}

# Recusa nome de ambiente que não seja identificador simples: ele vira parte de
# nome de arquivo, de variável e de caminho remoto.
jm_validar_ambiente() {
  local ambiente="$1"
  if ! printf '%s' "$ambiente" | grep -Eq '^[a-z][a-z0-9_-]*$'; then
    jm_erro "Nome de ambiente inválido: '$ambiente' (use letras minúsculas, dígitos, - e _)."
    return 1
  fi
}

# Recusa nome de tabela que não seja identificador simples: a lista vem do
# arquivo de configuração e é interpolada em SQL.
# Aceita `tabela` (subentende public) ou `schema.tabela`. O schema é preciso porque as
# contas da equipe vivem em auth.users e as fotos em storage.objects, fora do public, e são
# justamente elas que uma restauração incompleta perde sem ninguém notar.
jm_validar_tabela() {
  local tabela="$1"
  if ! printf '%s' "$tabela" | grep -Eq '^([a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*$'; then
    jm_erro "Nome de tabela inválido na configuração: '$tabela'."
    return 1
  fi
}

# Devolve o nome qualificado: `pedidos` vira `public.pedidos`, `auth.users` fica como está.
jm_tabela_qualificada() {
  case "$1" in
    *.*) printf '%s' "$1" ;;
    *)   printf 'public.%s' "$1" ;;
  esac
}

jm_exige_comandos() {
  local faltando=""
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || faltando="$faltando $cmd"
  done
  if [ -n "$faltando" ]; then
    jm_erro "Comando(s) faltando no servidor:$faltando"
    return 1
  fi
}

# ---------------------------------------------------------------- Postgres

# Executa psql no banco do ambiente. Duas formas, porque não sabemos ainda como
# a frente de infraestrutura vai expor o Postgres:
#  - MODO_BANCO=docker  (padrão): entra no contêiner e usa o cliente da própria
#    imagem, o que evita divergência de versão entre cliente e servidor 17.6;
#  - MODO_BANCO=host: usa o psql instalado na máquina, com host/porta.
jm_psql() {
  local ambiente="$1"; shift
  local modo container user db host porta senha
  modo="$(jm_var_ambiente "$ambiente" MODO_BANCO "${MODO_BANCO:-docker}")"
  # supabase_admin, e não postgres: os schemas `auth` e `storage` pertencem a ele, e o
  # `postgres` não os enxerga. Com `postgres`, o pg_dump omite os dois EM SILÊNCIO, e o
  # backup sai sem as contas da equipe e sem o registro das fotos (achado de 23/09/2026,
  # na primeira execução de verdade).
  user="$(jm_var_ambiente "$ambiente" PG_USER "${PG_USER:-supabase_admin}")"
  db="$(jm_var_ambiente "$ambiente" PG_DB "${PG_DB:-postgres}")"
  senha="$(jm_var_ambiente "$ambiente" PG_SENHA "")"

  if [ "$modo" = "docker" ]; then
    container="$(jm_var_ambiente "$ambiente" CONTAINER_DB "")"
    if [ -z "$container" ]; then
      jm_erro "Falta ${ambiente^^}_CONTAINER_DB na configuração."
      return 1
    fi
    docker exec -i -e PGPASSWORD="$senha" "$container" \
      psql -v ON_ERROR_STOP=1 -U "$user" -d "$db" "$@"
  else
    host="$(jm_var_ambiente "$ambiente" PG_HOST "127.0.0.1")"
    porta="$(jm_var_ambiente "$ambiente" PG_PORTA "5432")"
    PGPASSWORD="$senha" psql -v ON_ERROR_STOP=1 \
      -h "$host" -p "$porta" -U "$user" -d "$db" "$@"
  fi
}

# Contagem das tabelas principais, em TSV (tabela<TAB>linhas).
# É o número que a restauração vai conferir: sem ele, "restaurei" é opinião.
jm_contagens() {
  local ambiente="$1"
  local tabelas="${2:-$TABELAS_CONFERIDAS}"
  local sql="select 'tabela'::text as t, 0::bigint as n where false"
  local tabela
  for tabela in $tabelas; do
    jm_validar_tabela "$tabela" || return 1
    sql="$sql union all select '$tabela', count(*) from $(jm_tabela_qualificada "$tabela")"
  done
  sql="$sql order by 1"
  jm_psql "$ambiente" -tA -F $'\t' -c "$sql"
}

# ---------------------------------------------------------------- estado

# Diretório de estado, usado para o resumo semanal e para não repetir aviso.
jm_dir_estado() {
  local dir="${DIR_ESTADO:-/var/lib/jardim-menu/backup}"
  mkdir -p "$dir"
  printf '%s' "$dir"
}

# Tamanho legível de um arquivo, sem depender de `du -h` em locale estranho.
jm_tamanho() {
  local arquivo="$1"
  if [ -f "$arquivo" ]; then
    du -h "$arquivo" 2>/dev/null | cut -f1
  else
    printf '%s' '-'
  fi
}

# ---------------------------------------------------------------- Postgres: cliente do host

# Em MODO_BANCO=docker o cliente usado é o da própria imagem do Postgres 17.6, e por isso
# não há como haver divergência de versão. Em MODO_BANCO=host quem dumpa é o pg_dump
# instalado onde este script roda — e aí a divergência é possível, provável e cara:
#
#   - pg_dump MENOR que o servidor recusa a conexão ("server version 17.6; pg_dump version
#     16.x"), o que é ruim mas é barulhento;
#   - o caso pior é não ter o binário: em MODO_BANCO=host, um `pg_dump` inexistente só
#     aparece no meio da rodada, depois de a trava ter sido tomada.
#
# Isto existe por causa do Render: lá o backup roda num Cron Job, que é uma imagem magra
# montada por nós, e "esqueci de instalar o postgresql-client-17" é o erro mais provável da
# primeira noite. Falhar aqui, antes de tudo, é melhor do que falhar no meio.
jm_exige_cliente_pg() {
  # $1... nomes dos comandos (pg_dump, psql, pg_restore, pg_dumpall).
  jm_exige_comandos "$@" || return 1

  local versao maior
  versao="$(pg_dump --version 2>/dev/null | awk '{print $NF}')"
  maior="${versao%%.*}"
  case "$maior" in
    ''|*[!0-9]*)
      jm_aviso "Não consegui ler a versão do pg_dump ('$versao'); seguindo mesmo assim."
      return 0
      ;;
  esac
  # 17 é a versão do servidor (public.ecr.aws/supabase/postgres:17.6.x). Cliente mais NOVO
  # que o servidor é suportado; mais VELHO, não.
  if [ "$maior" -lt "${PG_VERSAO_SERVIDOR:-17}" ]; then
    jm_erro "pg_dump é da versão $maior e o banco é ${PG_VERSAO_SERVIDOR:-17}: ele recusa a conexão."
    jm_erro "Instale o postgresql-client-${PG_VERSAO_SERVIDOR:-17} na imagem que roda este script."
    return 1
  fi
}

# ---------------------------------------------------------------- Storage pela API

# Nome do marcador que vai na raiz do tar de fotos tirado pela API. Mora aqui, e não
# escrito à mão nos dois scripts, porque backup.sh o ESCREVE e restaurar.sh o LÊ: se os
# dois discordarem do nome, a restauração trata um tar do modo api como se fosse do modo
# docker e extrai as fotos em lugar errado, sem reclamar.
MARCADOR_STORAGE="${MARCADOR_STORAGE:-_jardim-storage.txt}"

# POR QUE ISTO EXISTE: no Render as fotos ficam no disco do serviço do Storage, e
# **Cron Job do Render não enxerga disco nenhum** — nem o próprio (não pode ter), nem o de
# outro serviço; one-off job também não vê o disco do serviço-base. O `tar` de
# /var/lib/storage, que é o caminho do compose, não tem como acontecer lá.
#
# A saída é falar com o storage-api por HTTP, e há duas decisões que valem ser ditas:
#
#  1. A LISTA DOS ARQUIVOS VEM DO BANCO, não do endpoint de listagem. `storage.objects` já
#     está na conexão que o backup usa e devolve o caminho exato de cada objeto numa
#     consulta só. O /object/list é paginado e trabalha por prefixo tipo pasta, então
#     varrer <loja>/<produto>/v<carimbo>/<arquivo> exigiria recursão escrita à mão — e o
#     jeito de errar isso é voltar MENOS fotos sem reclamar, que é a falha que este projeto
#     menos aceita. Com a lista vindo do banco, o número esperado é conhecido ANTES de
#     começar e é conferido no fim.
#  2. A CHAVE NÃO VAI EM ARGUMENTO. `curl -H "Authorization: Bearer <service_role>"` deixa a
#     chave visível no `ps` de qualquer processo da máquina. Os cabeçalhos vão num arquivo
#     de configuração do curl (-K), criado com 600 e apagado por quem chamou.

# Monta o arquivo -K do curl com os cabeçalhos de autenticação. Imprime o caminho.
jm_storage_conf_curl() {
  local chave="$1" arquivo
  arquivo="$(mktemp -t jardim-storage-XXXXXX.conf)" || return 1
  chmod 600 "$arquivo" 2>/dev/null || true
  # A service_role é JWT: serve tanto no apikey (que o Kong lê) quanto no Authorization
  # (que o storage-api valida). A rota storage-v1 do kong.yml não tem key-auth hoje, mas
  # mandar o apikey não atrapalha e faz o mesmo comando servir se um dia tiver.
  {
    printf 'header = "apikey: %s"\n' "$chave"
    printf 'header = "Authorization: Bearer %s"\n' "$chave"
    printf 'silent\nshow-error\n'
  } > "$arquivo"
  printf '%s' "$arquivo"
}

# Caminhos dos objetos de um bucket, um por linha, lidos do BANCO.
jm_storage_listar_do_banco() {
  local ambiente="$1" bucket="$2"
  # O nome do bucket é interpolado em SQL: mesma regra dos nomes de tabela.
  if ! printf '%s' "$bucket" | grep -Eq '^[a-zA-Z0-9._-]+$'; then
    jm_erro "Nome de bucket inválido: '$bucket'."
    return 1
  fi
  # `name is not null` porque a tabela também guarda linha de "pasta" em algumas versões do
  # storage-api, e pasta não é arquivo para baixar.
  jm_psql "$ambiente" -Atq -c \
    "select name from storage.objects where bucket_id = '$bucket' and name is not null order by name"
}

# Baixa UM objeto. Devolve 0 só quando o HTTP foi 200 E o arquivo tem conteúdo.
jm_storage_baixar() {
  local url_base="$1" bucket="$2" nome="$3" destino="$4" conf="$5"
  local http
  mkdir -p "$(dirname "$destino")" || return 1
  # --globoff: o caminho do objeto pode ter [ ] e o curl leria como faixa de URL.
  http="$(curl -K "$conf" --globoff --max-time "${STORAGE_TIMEOUT:-60}" \
    -o "$destino" -w '%{http_code}' \
    "${url_base}/storage/v1/object/${bucket}/${nome}" 2>/dev/null)" || http="000"
  if [ "$http" != "200" ]; then
    jm_erro "Storage respondeu HTTP $http ao baixar '$nome'."
    rm -f "$destino"
    return 1
  fi
  # Arquivo de zero byte com 200 é o storage devolvendo corpo vazio: foto que não voltou.
  # Sem esta conferência o tar sairia "completo" e cheio de nada.
  if [ ! -s "$destino" ]; then
    jm_erro "Storage devolveu 200 mas com corpo VAZIO em '$nome'."
    rm -f "$destino"
    return 1
  fi
}

# Envia UM objeto de volta. x-upsert porque a linha de storage.objects já voltou com o dump
# do banco (a restauração do banco vem antes): sem upsert o storage-api responde 409.
jm_storage_enviar() {
  local url_base="$1" bucket="$2" nome="$3" origem="$4" conf="$5"
  local http tipo
  case "$nome" in
    *.webp)       tipo='image/webp' ;;
    *.png)        tipo='image/png' ;;
    *.jpg|*.jpeg) tipo='image/jpeg' ;;
    *.avif)       tipo='image/avif' ;;
    *)            tipo='application/octet-stream' ;;
  esac
  http="$(curl -K "$conf" --globoff --max-time "${STORAGE_TIMEOUT:-60}" \
    -X POST -H "x-upsert: true" -H "Content-Type: $tipo" \
    --data-binary "@$origem" -o /dev/null -w '%{http_code}' \
    "${url_base}/storage/v1/object/${bucket}/${nome}" 2>/dev/null)" || http="000"
  case "$http" in
    200|201) return 0 ;;
    *) jm_erro "Storage respondeu HTTP $http ao enviar '$nome'."; return 1 ;;
  esac
}

# Qual caminho usar para as fotos de um ambiente: docker | host | api.
# O padrão é `auto`, que reproduz exatamente a escolha que o backup.sh já fazia antes de o
# modo `api` existir (pasta no host primeiro, contêiner depois). É isso que garante que a
# máquina de quem desenvolve e a esteira, que usam o compose, não mudem de comportamento.
jm_modo_storage() {
  local ambiente="$1" modo
  modo="$(jm_var_ambiente "$ambiente" MODO_STORAGE "${MODO_STORAGE:-auto}")"
  if [ "$modo" != "auto" ]; then printf '%s' "$modo"; return 0; fi
  local dir container
  dir="$(jm_var_ambiente "$ambiente" DIR_STORAGE "")"
  container="$(jm_var_ambiente "$ambiente" CONTAINER_STORAGE "")"
  if [ -n "$dir" ] && { [ -d "$dir" ] || [ -z "$container" ]; }; then
    printf 'host'
  elif [ -n "$container" ]; then
    printf 'docker'
  else
    printf 'nenhum'
  fi
}
