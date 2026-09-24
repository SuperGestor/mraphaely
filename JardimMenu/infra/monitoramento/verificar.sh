#!/usr/bin/env bash
#
# Monitoramento do Jardim Menu: roda a cada minuto e avisa no Telegram quando
# alguma coisa cai e quando volta.
#
# O que ele olha, em cada ambiente (produção e staging):
#   - o app Next.js, em GET <URL_APP>/api/saude;
#   - a API do Supabase, em GET <URL_API>/auth/v1/health;
#   - os contêineres que deveriam estar de pé;
#   - o disco do servidor, que é compartilhado pelos dois ambientes.
#
# Regras do aviso, para o canal não virar ruído:
#   - só avisa depois de FALHAS_PARA_ALERTAR verificações seguidas com erro
#     (padrão 2, isto é, dois minutos), porque um pico de um minuto não é queda;
#   - enquanto continuar fora, repete no máximo a cada MINUTOS_LEMBRETE
#     (padrão 60), e não a cada minuto;
#   - avisa de novo quando volta, com quanto tempo ficou fora;
#   - tudo o que a rodada tem a dizer sai numa mensagem só, e um item só é
#     marcado como "já avisei" depois de o Telegram aceitar a mensagem;
#   - de BATIMENTO_HORAS em BATIMENTO_HORAS sai um "monitoramento vivo", para
#     que silêncio no canal queira dizer alguma coisa.
#
# Uso: verificar.sh [--config CAMINHO] [--uma-vez] [--estado]
#   --uma-vez  ignora o contador e avisa já na primeira falha (para testar)
#   --estado   só mostra o estado guardado e sai, sem verificar nada

set -euo pipefail

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/comum.sh
. "$DIR_SCRIPT/lib/comum.sh"

ARQUIVO_CONFIG="${JARDIM_MONITOR_ENV:-/etc/jardim-menu/monitoramento.env}"
UMA_VEZ="nao"
SO_ESTADO="nao"

while [ $# -gt 0 ]; do
  case "$1" in
    --config) ARQUIVO_CONFIG="${2:-}"; shift 2 ;;
    --uma-vez) UMA_VEZ="sim"; shift ;;
    --estado) SO_ESTADO="sim"; shift ;;
    # Até a última linha do cabeçalho de uso; antes ia até a 24 e imprimia de brinde o
    # `set -euo pipefail` que vem logo abaixo.
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) jm_erro "Opção desconhecida: $1"; exit 2 ;;
  esac
done

jm_carregar_config "$ARQUIVO_CONFIG"

AMBIENTES="${AMBIENTES:-producao staging}"
DIR_ESTADO="${DIR_ESTADO:-/var/lib/jardim-menu/monitoramento}"
DIR_TRAVA="${DIR_TRAVA:-/var/lock}"
TIMEOUT_SEGUNDOS="${TIMEOUT_SEGUNDOS:-8}"
FALHAS_PARA_ALERTAR="${FALHAS_PARA_ALERTAR:-2}"
MINUTOS_LEMBRETE="${MINUTOS_LEMBRETE:-60}"
CAMINHO_SAUDE_APP="${CAMINHO_SAUDE_APP:-/api/saude}"
CAMINHO_SAUDE_API="${CAMINHO_SAUDE_API:-/auth/v1/health}"
# 200 e 204: o /api/saude do app responde 204 (sem corpo, de propósito — ele não toca no
# banco). Com só 200 na lista, o monitoramento alertaria queda do primeiro minuto em diante,
# com o app perfeitamente de pé.
CODIGOS_OK="${CODIGOS_OK:-200 204}"
LIMITE_DISCO="${LIMITE_DISCO:-85}"
FOLGA_DISCO="${FOLGA_DISCO:-5}"
PONTOS_DE_MONTAGEM="${PONTOS_DE_MONTAGEM:-/}"
# De quantas em quantas horas sai o "monitoramento vivo". Sem esse batimento,
# canal quieto tanto pode ser "está tudo bem" quanto "o monitoramento morreu e
# ninguém percebeu" — e foi assim que a única rede de proteção virou a frase
# "se ficar quieto por uma semana, desconfie". 0 desliga.
BATIMENTO_HORAS="${BATIMENTO_HORAS:-24}"
# Carência depois que o servidor liga. Ver o bloco de carência mais abaixo.
CARENCIA_BOOT_SEGUNDOS="${CARENCIA_BOOT_SEGUNDOS:-180}"

[ "$UMA_VEZ" = "sim" ] && FALHAS_PARA_ALERTAR=1

jm_exige_comandos curl date awk df flock

mkdir -p "$DIR_ESTADO" "$DIR_TRAVA"

if [ "$SO_ESTADO" = "sim" ]; then
  echo "Estado guardado em $DIR_ESTADO:"
  for arquivo in "$DIR_ESTADO"/*.estado; do
    [ -f "$arquivo" ] || { echo "  (nada ainda: o monitoramento nunca rodou)"; break; }
    printf '  %-40s %s\n' "$(basename "$arquivo" .estado)" "$(cat "$arquivo")"
  done
  exit 0
fi

# Carência depois do boot. O jardim-monitor.timer já entrega isso pelo par
# OnBootSec/OnUnitActiveSec, mas o comentário dele já prometeu essa carência uma vez e não
# cumpriu (com OnCalendar junto, quem vence é o calendário, e a primeira verificação saía
# em menos de 60 s depois do boot): o db ainda no pg_isready, o app dentro do start_period,
# nada respondendo, e o dono acordando às 3h por causa de uma partida normal. Aqui a
# carência é do script, então vale também para quem chamar por cron ou à mão.
# --uma-vez é teste do operador e não espera nada.
if [ "$UMA_VEZ" != "sim" ] && [ "$CARENCIA_BOOT_SEGUNDOS" -gt 0 ] && [ -r /proc/uptime ]; then
  LIGADO_HA="$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 999999)"
  if [ "${LIGADO_HA:-999999}" -lt "$CARENCIA_BOOT_SEGUNDOS" ]; then
    jm_log "Servidor ligado há ${LIGADO_HA}s: esperando a carência de ${CARENCIA_BOOT_SEGUNDOS}s para não acusar queda do que ainda está subindo."
    exit 0
  fi
fi

# Uma verificação de cada vez. Se a anterior ainda está pendurada num timeout,
# a de agora sai calada em vez de dobrar as conexões.
exec 9>"$DIR_TRAVA/jardim-monitor.lock"
if ! flock -n 9; then
  jm_log "A verificação anterior ainda está rodando. Saindo."
  exit 0
fi

# ---------------------------------------------------------------- fila de avisos

# Por que existe uma fila em vez de um envio por item, e por que o estado só é gravado
# depois do envio:
#
# 1) Numa queda de verdade cai tudo junto — o db leva auth, rest, storage e realtime
#    embora, cinco mensagens por ambiente. Uma a uma, o Telegram começa a responder 429
#    por volta de 20 mensagens por minuto no mesmo grupo e os avisos seguintes não
#    chegam.
# 2) Cada envio gasta até 20 s de --max-time; em rajada, o TimeoutStartSec=50 da unidade
#    matava a verificação no meio.
# 3) O defeito grave que motivou tudo isto: o estado ("já avisei que este item caiu") era
#    gravado ANTES do envio. Envio recusado — 429, rede fora, token errado — e o item
#    ficava marcado como avisado sem ninguém ter sido avisado. A queda sumia até o
#    próximo lembrete (60 min) ou para sempre, com MINUTOS_LEMBRETE=0.
#
# Agora as verificações enfileiram o texto junto com a marcação que aquele texto
# autoriza, e a marcação só é aplicada quando o Telegram aceita. Se não aceitar, nada é
# marcado e a rodada do minuto seguinte tenta de novo.

# O Telegram corta a mensagem em 4096 caracteres; o limite menor deixa folga. Fica
# ajustável pela configuração para o dia em que esse número mudar — e para dar como
# testar a quebra em várias mensagens sem precisar derrubar meio servidor.
LIMITE_MENSAGEM="${LIMITE_MENSAGEM:-3500}"
FILA_TEXTO=""
FILA_ACOES=()
ITENS_VERIFICADOS=0

enfileirar() {
  local texto="$1" acao="${2:-}"
  # Se juntar este aviso estourasse o limite, manda antes o que já está na fila: assim
  # cada mensagem leva só as marcações que ela própria entrega.
  if [ -n "$FILA_TEXTO" ] && [ $(( ${#FILA_TEXTO} + ${#texto} + 2 )) -gt "$LIMITE_MENSAGEM" ]; then
    descarregar
  fi
  if [ -n "$FILA_TEXTO" ]; then
    FILA_TEXTO="${FILA_TEXTO}"$'\n\n'"${texto}"
  else
    FILA_TEXTO="$texto"
  fi
  [ -n "$acao" ] && FILA_ACOES+=("$acao")
  return 0
}

descarregar() {
  [ -n "$FILA_TEXTO" ] || return 0
  local texto="$FILA_TEXTO"
  local acoes=()
  [ ${#FILA_ACOES[@]} -gt 0 ] && acoes=("${FILA_ACOES[@]}")
  FILA_TEXTO=""
  FILA_ACOES=()

  # jm_telegram devolve o status de verdade desde a correção em lib/comum.sh. A chamada
  # dentro de `if` é de propósito: envio recusado não derruba a rodada, só deixa tudo por
  # marcar. Quem falha alto aqui é o journal, e a unidade jardim-monitor-falhou cobre o
  # caso em que nem o script chega a rodar.
  local acao
  if jm_telegram "$texto"; then
    if [ ${#acoes[@]} -gt 0 ]; then
      for acao in "${acoes[@]}"; do
        aplicar_acao "$acao"
      done
    fi
  else
    jm_aviso "O Telegram não aceitou a mensagem: nada foi marcado como avisado; a próxima rodada tenta de novo."
  fi
  return 0
}

# As marcações que um envio bem-sucedido autoriza. Formato: tipo|id|carimbo. O id já
# passou por jm_identificador, então não tem '|' para atrapalhar a leitura.
aplicar_acao() {
  local tipo id quando
  IFS='|' read -r tipo id quando <<< "$1"
  case "$tipo" in
    caiu)
      echo caido > "$DIR_ESTADO/$id.estado"
      echo "$quando" > "$DIR_ESTADO/$id.desde"
      echo "$quando" > "$DIR_ESTADO/$id.lembrete"
      ;;
    voltou)
      echo ok > "$DIR_ESTADO/$id.estado"
      rm -f "$DIR_ESTADO/$id.desde" "$DIR_ESTADO/$id.lembrete"
      ;;
    lembrete)
      echo "$quando" > "$DIR_ESTADO/$id.lembrete"
      ;;
    batimento)
      echo "$quando" > "$DIR_ESTADO/.batimento"
      ;;
    *)
      jm_aviso "Marcação desconhecida, ignorada: $1"
      ;;
  esac
}

# ---------------------------------------------------------------- estado

# Todo o controle de repetição mora aqui: esta função recebe o resultado cru de
# uma verificação e decide se alguém precisa ser avisado.
avaliar() {
  local id rotulo resultado detalhe
  id="$(jm_identificador "$1")"; rotulo="$2"; resultado="$3"; detalhe="${4:-}"

  ITENS_VERIFICADOS=$(( ITENS_VERIFICADOS + 1 ))

  local arq_estado="$DIR_ESTADO/$id.estado"
  local arq_falhas="$DIR_ESTADO/$id.falhas"
  local arq_desde="$DIR_ESTADO/$id.desde"
  local arq_lembrete="$DIR_ESTADO/$id.lembrete"
  local estado falhas agora desde ultimo tempo
  agora="$(date +%s)"
  estado="$(cat "$arq_estado" 2>/dev/null || echo ok)"
  falhas="$(cat "$arq_falhas" 2>/dev/null || echo 0)"

  if [ "$resultado" = "ok" ]; then
    echo 0 > "$arq_falhas"
    if [ "$estado" = "caido" ]; then
      desde="$(cat "$arq_desde" 2>/dev/null || echo "$agora")"
      tempo="$(jm_duracao $(( agora - desde )))"
      jm_log "VOLTOU: $rotulo (ficou fora por $tempo)"
      # Só marca como de volta depois de a mensagem sair. Marcar antes fazia o aviso de
      # volta perdido sumir de vez: na rodada seguinte o estado já era "ok" e ninguém
      # nunca ficava sabendo que tinha voltado.
      enfileirar "$(printf '%s\n' \
        "Jardim Menu — VOLTOU: ${rotulo}" \
        "Ficou fora por ${tempo}." \
        "$detalhe")" "voltou|$id|$agora"
    fi
    return 0
  fi

  falhas=$(( falhas + 1 ))
  echo "$falhas" > "$arq_falhas"
  jm_log "FALHA ${falhas}/${FALHAS_PARA_ALERTAR}: $rotulo — $detalhe"

  if [ "$estado" != "caido" ] && [ "$falhas" -ge "$FALHAS_PARA_ALERTAR" ]; then
    # Enquanto o envio não der certo, o item continua com estado "ok" e o contador de
    # falhas continua subindo: a rodada seguinte entra aqui de novo e tenta outra vez. A
    # mensagem diz quantas falhas seguidas já são, então uma tentativa que só vence no
    # quinto minuto chega dizendo "falhou 5 vezes".
    enfileirar "$(printf '%s\n' \
      "Jardim Menu — CAIU: ${rotulo}" \
      "${detalhe}" \
      "Falhou ${falhas} vez(es) seguidas." \
      "O que fazer está em docs/operacao/MONITORAMENTO.md.")" "caiu|$id|$agora"
    return 0
  fi

  # Já avisado: no máximo um lembrete por MINUTOS_LEMBRETE. Repetir a cada
  # minuto faria a equipe silenciar o canal, e aí o próximo aviso de verdade
  # não chegaria em ninguém.
  if [ "$estado" = "caido" ] && [ "$MINUTOS_LEMBRETE" -gt 0 ]; then
    ultimo="$(cat "$arq_lembrete" 2>/dev/null || echo 0)"
    if [ $(( agora - ultimo )) -ge $(( MINUTOS_LEMBRETE * 60 )) ]; then
      desde="$(cat "$arq_desde" 2>/dev/null || echo "$agora")"
      tempo="$(jm_duracao $(( agora - desde )))"
      enfileirar "$(printf '%s\n' \
        "Jardim Menu — AINDA FORA: ${rotulo}" \
        "Já são ${tempo}." \
        "${detalhe}")" "lembrete|$id|$agora"
    fi
  fi
}

# ---------------------------------------------------------------- verificações

# Devolve só o código HTTP. Em falha de conexão, DNS ou timeout, devolve 000,
# que é o jeito do curl de dizer "nem cheguei a falar com ninguém".
codigo_http() {
  local url="$1" chave="${2:-}"
  local args=(-sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT_SEGUNDOS" -A 'jardim-monitor/1')
  # A API do Supabase fica atrás do Kong, que costuma exigir a chave anon até
  # em /auth/v1/health. Sem a chave, a resposta seria 401 e o monitor acusaria
  # queda que não existe.
  [ -n "$chave" ] && args+=(-H "apikey: $chave")
  local codigo
  codigo="$(curl "${args[@]}" "$url" 2>/dev/null)" || true
  [ -z "$codigo" ] && codigo="000"
  printf '%s' "$codigo"
}

codigo_aceito() {
  local codigo="$1" aceito
  for aceito in $CODIGOS_OK; do
    [ "$codigo" = "$aceito" ] && return 0
  done
  return 1
}

explicar_codigo() {
  case "$1" in
    000) printf 'não respondeu (fora do ar, DNS, certificado ou timeout de %ss)' "$TIMEOUT_SEGUNDOS" ;;
    401|403) printf 'respondeu %s: o endereço está de pé, mas recusou a chave. Confira a chave anon na configuração do monitoramento' "$1" ;;
    404) printf 'respondeu 404: o endereço subiu, mas a rota de saúde não existe nessa versão do app' ;;
    502|503|504) printf 'respondeu %s: o proxy está de pé e quem está atrás dele, não' "$1" ;;
    *) printf 'respondeu %s' "$1" ;;
  esac
}

verificar_ambiente() {
  local ambiente="$1"
  jm_validar_ambiente "$ambiente" || return 0

  local url_app url_api chave codigo
  url_app="$(jm_var_ambiente "$ambiente" URL_APP "")"
  url_api="$(jm_var_ambiente "$ambiente" URL_API "")"
  chave="$(jm_var_ambiente "$ambiente" CHAVE_ANON "")"

  if [ -n "$url_app" ]; then
    codigo="$(codigo_http "${url_app}${CAMINHO_SAUDE_APP}" "")"
    if codigo_aceito "$codigo"; then
      avaliar "${ambiente}-app" "app de ${ambiente}" ok
    else
      avaliar "${ambiente}-app" "app de ${ambiente}" falha \
        "GET ${url_app}${CAMINHO_SAUDE_APP} $(explicar_codigo "$codigo")"
    fi
  else
    jm_aviso "[$ambiente] ${ambiente^^}_URL_APP não configurada: o app não está sendo vigiado."
  fi

  if [ -n "$url_api" ]; then
    codigo="$(codigo_http "${url_api}${CAMINHO_SAUDE_API}" "$chave")"
    if codigo_aceito "$codigo"; then
      avaliar "${ambiente}-api" "API do Supabase de ${ambiente}" ok
    else
      avaliar "${ambiente}-api" "API do Supabase de ${ambiente}" falha \
        "GET ${url_api}${CAMINHO_SAUDE_API} $(explicar_codigo "$codigo")"
    fi
  else
    jm_aviso "[$ambiente] ${ambiente^^}_URL_API não configurada: a API não está sendo vigiada."
  fi

  # Contêineres daquele ambiente. O nome sai do compose da frente de
  # infraestrutura, então vem da configuração e não do código.
  local lista nome estado_container
  lista="$(jm_var_ambiente "$ambiente" CONTAINERS "")"
  if [ -n "$lista" ] && command -v docker >/dev/null 2>&1; then
    for nome in $lista; do
      estado_container="$(docker inspect -f '{{.State.Status}}' "$nome" 2>/dev/null || echo 'inexistente')"
      if [ "$estado_container" = "running" ]; then
        avaliar "${ambiente}-container-${nome}" "contêiner ${nome} (${ambiente})" ok
      else
        avaliar "${ambiente}-container-${nome}" "contêiner ${nome} (${ambiente})" falha \
          "docker diz: ${estado_container}. Veja: docker logs --tail 50 ${nome}"
      fi
    done
  fi
}

verificar_disco() {
  local ponto usado livre id
  for ponto in $PONTOS_DE_MONTAGEM; do
    if [ ! -d "$ponto" ]; then
      jm_aviso "Ponto de montagem inexistente: $ponto"
      continue
    fi
    # Campos contados da DIREITA. Com -P a saída é uma linha só, e a última coluna é o
    # ponto de montagem: capacidade é NF-1 e disponível é NF-2. Contar da esquerda quebra
    # quando o nome do dispositivo tem espaço — no Git Bash do Windows ele é
    # "C:/Program Files/Git", e a leitura devolvia 71068692% de uso.
    usado="$(df -P "$ponto" | awk 'NR==2 {gsub(/%/,"",$(NF-1)); print $(NF-1)}')"
    livre="$(df -Ph "$ponto" | awk 'NR==2 {print $(NF-2)" livres de "$(NF-4)}')"
    id="disco-$(jm_identificador "$ponto")"

    # Histerese: sobe o alarme em LIMITE_DISCO e só desce em LIMITE - FOLGA.
    # Sem isso, um disco parado em 85% avisaria "encheu" e "esvaziou" o dia
    # inteiro, e ninguém mais leria o canal.
    if [ "$usado" -ge "$LIMITE_DISCO" ]; then
      avaliar "$id" "disco em ${ponto}" falha \
        "${usado}% usado (limite ${LIMITE_DISCO}%), ${livre}. Os backups locais ficam em /var/backups/jardim-menu."
    elif [ "$usado" -le $(( LIMITE_DISCO - FOLGA_DISCO )) ]; then
      avaliar "$id" "disco em ${ponto}" ok "Agora em ${usado}% usado, ${livre}."
    fi
  done
}

# ---------------------------------------------------------------- batimento

# "Monitoramento vivo", de BATIMENTO_HORAS em BATIMENTO_HORAS. Sem isto, canal quieto é
# ambíguo: pode ser noite tranquila ou pode ser o monitoramento morto — e morto em
# silêncio ele já ficou, com uma linha errada no .env derrubando o script todo minuto.
# Com o batimento, a falta da mensagem diária é em si o alarme.
batimento() {
  [ "$BATIMENTO_HORAS" -gt 0 ] || return 0

  local arq="$DIR_ESTADO/.batimento" ultimo agora arquivo fora=0
  agora="$(date +%s)"
  ultimo="$(cat "$arq" 2>/dev/null || echo 0)"
  [ $(( agora - ultimo )) -ge $(( BATIMENTO_HORAS * 3600 )) ] || return 0

  for arquivo in "$DIR_ESTADO"/*.estado; do
    [ -f "$arquivo" ] || continue
    # if/fi e não `&&`: com set -e, um `[ ... ] && x` como último comando do laço
    # derrubaria a rodada na primeira verificação que estivesse de pé.
    if [ "$(cat "$arquivo")" = "caido" ]; then
      fora=$(( fora + 1 ))
    fi
  done

  enfileirar "$(printf '%s\n' \
    "Jardim Menu — monitoramento vivo." \
    "${ITENS_VERIFICADOS} verificações nesta rodada, ${fora} item(ns) fora do ar agora." \
    "Esta mensagem sai a cada ${BATIMENTO_HORAS}h. Se ela faltar, o monitoramento é que caiu.")" \
    "batimento|-|$agora"
}

# ---------------------------------------------------------------- rodada

for ambiente in $AMBIENTES; do
  verificar_ambiente "$ambiente"
done
verificar_disco
batimento
descarregar

# Sai 0 mesmo com envio recusado: o que falhou foi o Telegram, não a verificação, e a
# rodada do minuto seguinte tenta de novo. Sair 1 aqui faria o OnFailure da unidade
# disparar a cada minuto contra um canal que já se sabe fora.
exit 0
