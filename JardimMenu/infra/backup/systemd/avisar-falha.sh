#!/usr/bin/env bash
#
# Aviso de última instância: manda para o Telegram o fim do journal de uma unidade que
# falhou. Quem chama é o OnFailure= das unidades do Jardim Menu (hoje, o
# jardim-backup.service).
#
# Por que existe: o único canal de aviso do backup era o próprio backup.sh, e tudo que
# impede o script de chegar ao fim ficava só no journal — ExecStart apontando para um
# caminho que não existe (status=203/EXEC), configuração ilegível (o script morre ao
# carregá-la, e o token do Telegram vem justamente dela), TimeoutStartSec estourado com o
# rclone pendurado, OOM killer. Ninguém lê journal às 5h da manhã.
#
# Por que é um arquivo separado, instalado FORA da árvore do repositório
# (/usr/local/sbin/jardim-avisar-falha): um dos motivos de falha é o caminho do
# repositório estar errado. Aviso que mora no caminho que pode estar errado não avisa.
#
# Uso: jardim-avisar-falha <unidade> [arquivo-de-configuração]
#   O arquivo de configuração padrão é $JARDIM_BACKUP_ENV ou /etc/jardim-menu/backup.env.
#
# Sai 0 quando o aviso saiu (ou quando não havia Telegram configurado, e aí ele fica no
# journal), 1 quando o Telegram recusou, 2 quando foi chamado errado.

# Sem `-e`: aqui o certo é tentar até o fim e relatar, não morrer no primeiro tropeço.
# Este script é a última linha de defesa; se ELE desistir em silêncio, não sobra ninguém.
set -uo pipefail

UNIDADE="${1:-}"
CONFIG="${2:-${JARDIM_BACKUP_ENV:-/etc/jardim-menu/backup.env}}"

registrar() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*" >&2
}

if [ -z "$UNIDADE" ]; then
  registrar "ERRO: falta o nome da unidade. Uso: $(basename "$0") <unidade> [config]"
  exit 2
fi

# Lê uma variável do .env SEM executar o arquivo. `source` seria errado duas vezes: a
# configuração quebrada é um dos motivos de a unidade ter falhado (e o source morreria
# junto), e um valor com espaço sem aspas vira execução de comando — a mesma armadilha
# que o infra/scripts/publicar.sh já documenta.
ler_var() {
  local nome="$1" valor
  valor="$(sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}${nome}=//p" "$CONFIG" 2>/dev/null | tail -n 1)"
  valor="${valor%$'\r'}"
  case "$valor" in
    \"*\") valor="${valor#\"}"; valor="${valor%\"}" ;;
    \'*\') valor="${valor#\'}"; valor="${valor%\'}" ;;
  esac
  printf '%s' "$valor"
}

TOKEN="$(ler_var ALERT_TELEGRAM_BOT_TOKEN)"
CHAT="$(ler_var ALERT_TELEGRAM_CHAT_ID)"

RESULTADO="$(systemctl show -p Result --value "$UNIDADE" 2>/dev/null)"
# O Telegram corta em 4096 caracteres; 2500 do fim do journal cabem com folga junto do
# cabeçalho, e é o fim que interessa.
TRECHO="$(journalctl -u "$UNIDADE" -n 25 --no-pager 2>&1 | tail -c 2500)"
[ -n "$TRECHO" ] || TRECHO="(o journal de ${UNIDADE} não tem nada — sinal de que a unidade nem chegou a executar)"

TEXTO="$(printf '%s\n' \
  "Jardim Menu — a unidade ${UNIDADE} FALHOU ($(date '+%Y-%m-%d %H:%M'))" \
  "Resultado do systemd: ${RESULTADO:-desconhecido}" \
  "" \
  "Este aviso vem do systemd, não do script: a rodada pode nem ter começado, e nesse caso" \
  "NÃO existe backup novo de hoje." \
  "" \
  "O que fazer: systemctl status ${UNIDADE} e docs/operacao/BACKUP.md." \
  "" \
  "Fim do journal:" \
  "${TRECHO}")"

# Sai 1, e não 0: este é o aviso de última instância, e terminar bem sem ter avisado
# ninguém é a falha silenciosa que ele existe para impedir. Com 1, a unidade aparece em
# `systemctl --failed`, que é o único sinal que sobra na máquina quando não há canal.
if [ -z "$TOKEN" ] || [ -z "$CHAT" ]; then
  registrar "AVISO QUE NÃO PÔDE SER ENVIADO: ${TEXTO}"
  registrar "ERRO: ${UNIDADE} falhou e NÃO houve como avisar: falta ALERT_TELEGRAM_BOT_TOKEN ou ALERT_TELEGRAM_CHAT_ID em ${CONFIG}."
  exit 1
fi

# A URL vai por stdin (curl -K -), e não na linha de comando: a URL carrega o token do bot,
# e linha de comando aparece no `ps` para qualquer usuário da máquina.
http="$(printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TOKEN" \
  | curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -K - \
      --data-urlencode "chat_id=${CHAT}" \
      --data-urlencode "text=${TEXTO}" \
      --data-urlencode "disable_web_page_preview=true" 2>/dev/null)" || http="000"

if [ "$http" = "200" ]; then
  registrar "Aviso de falha de ${UNIDADE} enviado ao Telegram."
  exit 0
fi

# Nunca repetimos o corpo da resposta do Telegram: ele pode ecoar a URL, e a URL tem o token.
registrar "ERRO: o Telegram respondeu HTTP ${http}; o aviso de falha de ${UNIDADE} NÃO chegou. Confira o token e o chat_id em ${CONFIG}."
exit 1
