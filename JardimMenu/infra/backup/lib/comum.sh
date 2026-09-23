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

jm_log() {
  printf '[%s] %s\n' "$(jm_agora)" "$*"
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
