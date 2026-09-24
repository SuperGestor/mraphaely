#!/usr/bin/env bash
#
# Avisa no Telegram que uma unidade do monitoramento falhou.
#
# Quem chama é o OnFailure= do jardim-monitor.service. É o aviso de último recurso: vale
# justamente para os casos em que o verificar.sh não chegou a rodar — caminho errado no
# ExecStart, configuração com uma linha que o `source` tenta executar, timeout, OOM —,
# quando não existe mais ninguém para falar pelo monitoramento.
#
# Uso: avisar-falha.sh [UNIDADE]      (padrão: jardim-monitor.service)

# Sem `set -e` de propósito, ao contrário do resto da casa: este script existe para falar
# quando as coisas já estão quebradas, e morrer no primeiro comando que der errado é
# exatamente o que ele precisa não fazer. Cada passo trata o próprio erro.
set -uo pipefail

UNIDADE="${1:-jardim-monitor.service}"
ARQUIVO_CONFIG="${JARDIM_MONITOR_ENV:-/etc/jardim-menu/monitoramento.env}"

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/comum.sh
. "$DIR_SCRIPT/lib/comum.sh"

# ---------------------------------------------------------------- configuração

# Lê o .env SEM executá-lo. O jm_carregar_config usa `source`, e `source` num .env é
# armadilha conhecida nesta casa (infra/scripts/publicar.sh diz o mesmo): uma linha como
# PRODUCAO_CONTAINERS=jardim-db jardim-auth, sem aspas, vira o comando `jardim-auth`. É
# exatamente um dos motivos de este script ser chamado — se ele lesse a configuração do
# mesmo jeito, morreria pelo mesmo motivo e o aviso não sairia.
ler_var() {
  # $1 arquivo, $2 nome. Última ocorrência vence, como no compose. O tr tira o \r de
  # arquivo que passou por editor de Windows; o sed tira aspas ao redor do valor.
  sed -n "s/^[[:space:]]*$2=//p" "$1" 2>/dev/null \
    | tail -n 1 \
    | tr -d '\r' \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

if [ -r "$ARQUIVO_CONFIG" ]; then
  ALERT_TELEGRAM_BOT_TOKEN="$(ler_var "$ARQUIVO_CONFIG" ALERT_TELEGRAM_BOT_TOKEN)"
  ALERT_TELEGRAM_CHAT_ID="$(ler_var "$ARQUIVO_CONFIG" ALERT_TELEGRAM_CHAT_ID)"
  DIR_ESTADO="$(ler_var "$ARQUIVO_CONFIG" DIR_ESTADO)"
else
  jm_erro "Configuração não encontrada ou sem leitura: $ARQUIVO_CONFIG"
  ALERT_TELEGRAM_BOT_TOKEN=""
  ALERT_TELEGRAM_CHAT_ID=""
  DIR_ESTADO=""
fi
DIR_ESTADO="${DIR_ESTADO:-/var/lib/jardim-menu/monitoramento}"
MINUTOS_ENTRE_AVISOS="${MINUTOS_ENTRE_AVISOS_FALHA:-60}"

mkdir -p "$DIR_ESTADO" 2>/dev/null || true

# ---------------------------------------------------------------- repetição

# Unidade quebrada falha a cada minuto, junto com o timer. Sem esta trava seriam 60
# mensagens por hora, o canal seria silenciado pela equipe e o próximo aviso de verdade
# não chegaria em ninguém — que é o problema que este monitoramento inteiro tenta evitar.
CARIMBO="$DIR_ESTADO/.falha-$(jm_identificador "$UNIDADE")"
AGORA="$(date +%s)"
ULTIMO="$(cat "$CARIMBO" 2>/dev/null || echo 0)"
case "$ULTIMO" in ''|*[!0-9]*) ULTIMO=0 ;; esac

if [ "$ULTIMO" -gt 0 ] && [ $(( AGORA - ULTIMO )) -lt $(( MINUTOS_ENTRE_AVISOS * 60 )) ]; then
  jm_log "Falha de ${UNIDADE} já avisada há menos de ${MINUTOS_ENTRE_AVISOS}min; não repito (o journal continua registrando)."
  exit 0
fi

# ---------------------------------------------------------------- mensagem

# O journal pode ter ecoado o valor de uma variável na hora do erro de configuração.
# Mandar isso adiante seria espalhar segredo, então o que sai daqui vai mascarado.
esconder_segredos() {
  sed -E \
    -e 's/([A-Za-z_]*(TOKEN|SENHA|PASSWORD|SECRET|KEY)[A-Za-z_]*=)[^[:space:]]*/\1***/g' \
    -e 's#bot[0-9]{5,}:[A-Za-z0-9_-]{10,}#bot***#g'
}

ESTADO="$(systemctl is-failed "$UNIDADE" 2>/dev/null || true)"
[ -n "$ESTADO" ] || ESTADO="desconhecido"

RESUMO=""
if command -v journalctl >/dev/null 2>&1; then
  RESUMO="$(journalctl -u "$UNIDADE" -n 25 --no-pager 2>&1 | esconder_segredos | tail -c 2000)"
fi
[ -n "$RESUMO" ] || RESUMO="(sem linhas no journal)"

MENSAGEM="$(printf '%s\n' \
  "Jardim Menu — O MONITORAMENTO FALHOU: ${UNIDADE}" \
  "Estado: ${ESTADO}. Enquanto ela não voltar, NADA está sendo vigiado." \
  "" \
  "Últimas linhas do journal:" \
  "${RESUMO}" \
  "" \
  "Confira: systemctl status ${UNIDADE} — journalctl -u ${UNIDADE} -n 50")"

# ---------------------------------------------------------------- envio

if jm_telegram "$MENSAGEM"; then
  # Carimbo só serve para não repetir o aviso. Se nem isso der para gravar (diretório de
  # estado inexistente, disco cheio), o aviso já saiu: vale mais dizer no journal e sair
  # bem do que morrer aqui com um erro cru do bash.
  # Subshell para o próprio erro do bash no redirecionamento não sujar o journal: quem
  # explica o problema é a linha de aviso abaixo.
  if ! ( echo "$AGORA" > "$CARIMBO" ) 2>/dev/null; then
    jm_aviso "Não consegui gravar ${CARIMBO}: o próximo aviso desta unidade vai repetir."
  fi
  exit 0
fi

# Sai 1 para a unidade de aviso aparecer em `systemctl --failed`: se nem o aviso saiu,
# não existe mais nenhum sinal, e pelo menos fica o rastro na máquina.
jm_erro "Não consegui avisar no Telegram que ${UNIDADE} falhou."
exit 1
