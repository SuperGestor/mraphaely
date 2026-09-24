# shellcheck shell=bash
# Funções comuns do monitoramento do Jardim Menu.
#
# Carregado com `source`, não roda sozinho: por isso não tem shebang nem
# `set -e`. A repetição de jm_log e jm_telegram em relação a
# infra/backup/lib/comum.sh é deliberada, para que esta pasta possa ir sozinha
# para o servidor sem depender da outra.

# ---------------------------------------------------------------- log

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

# Duração legível, para a mensagem dizer "ficou fora por 12min" em vez de 720.
jm_duracao() {
  local s="$1"
  if [ "$s" -lt 60 ]; then
    printf '%ds' "$s"
  elif [ "$s" -lt 3600 ]; then
    printf '%dmin' $(( s / 60 ))
  else
    printf '%dh %02dmin' $(( s / 3600 )) $(( (s % 3600) / 60 ))
  fi
}

# ---------------------------------------------------------------- Telegram

# Canal escolhido pelo PO em 22/09/2026. As mesmas duas variáveis servem ao
# aviso de erro do app (NF-009), que outra frente implementa: aqui elas são só
# repassadas pela configuração.
#
# Devolve 0 quando o Telegram aceitou e 1 quando recusou. Isto não é detalhe: enquanto
# devolvia 0 sempre, o verificar.sh gravava "já avisei que caiu" para um aviso que o
# Telegram tinha respondido com 429, e a queda sumia do canal por uma hora — ou para
# sempre, com MINUTOS_LEMBRETE=0. Quem chamar precisa tratar o 1; e cuidado com o
# `set -e`: chamada solta, um envio recusado passa a derrubar o script.
jm_telegram() {
  local texto="$1"
  local token="${ALERT_TELEGRAM_BOT_TOKEN:-}"
  local chat="${ALERT_TELEGRAM_CHAT_ID:-}"

  # Sem canal configurado devolve 0 de propósito: não há o que tentar de novo, e um 1 aqui
  # faria o monitor repetir o mesmo aviso no journal a cada minuto, para sempre.
  if [ -z "$token" ] || [ -z "$chat" ]; then
    jm_aviso "Telegram não configurado. Aviso só no log."
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
    return 0
  fi

  # Sem ecoar a resposta: ela repete a URL, e a URL carrega o token.
  jm_aviso "Telegram respondeu HTTP ${http}; o aviso não chegou."
  return 1
}

# ---------------------------------------------------------------- configuração

jm_carregar_config() {
  local arquivo="$1"
  if [ ! -r "$arquivo" ]; then
    jm_erro "Configuração não encontrada ou sem leitura: $arquivo"
    jm_erro "Copie infra/monitoramento/exemplo/monitoramento.env.exemplo para lá e preencha."
    return 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$arquivo"
  set +a
}

jm_var_ambiente() {
  local ambiente="$1" sufixo="$2" padrao="${3-}"
  local nome="${ambiente^^}_${sufixo}"
  nome="${nome//-/_}"
  printf '%s' "${!nome:-$padrao}"
}

jm_validar_ambiente() {
  local ambiente="$1"
  if ! printf '%s' "$ambiente" | grep -Eq '^[a-z][a-z0-9_-]*$'; then
    jm_erro "Nome de ambiente inválido: '$ambiente'."
    return 1
  fi
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

# Transforma qualquer rótulo em nome de arquivo seguro para o diretório de
# estado (nome de contêiner pode ter ponto, barra e maiúscula).
jm_identificador() {
  printf '%s' "$1" | tr -c 'a-zA-Z0-9_-' '_'
}
