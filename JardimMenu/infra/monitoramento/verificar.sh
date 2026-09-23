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
#   - avisa de novo quando volta, com quanto tempo ficou fora.
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
    -h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}"; exit 0 ;;
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
CODIGOS_OK="${CODIGOS_OK:-200}"
LIMITE_DISCO="${LIMITE_DISCO:-85}"
FOLGA_DISCO="${FOLGA_DISCO:-5}"
PONTOS_DE_MONTAGEM="${PONTOS_DE_MONTAGEM:-/}"

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

# Uma verificação de cada vez. Se a anterior ainda está pendurada num timeout,
# a de agora sai calada em vez de dobrar as conexões.
exec 9>"$DIR_TRAVA/jardim-monitor.lock"
if ! flock -n 9; then
  jm_log "A verificação anterior ainda está rodando. Saindo."
  exit 0
fi

# ---------------------------------------------------------------- estado

# Todo o controle de repetição mora aqui: esta função recebe o resultado cru de
# uma verificação e decide se alguém precisa ser avisado.
avaliar() {
  local id rotulo resultado detalhe
  id="$(jm_identificador "$1")"; rotulo="$2"; resultado="$3"; detalhe="${4:-}"

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
      jm_telegram "$(printf '%s\n' \
        "Jardim Menu — VOLTOU: ${rotulo}" \
        "Ficou fora por ${tempo}." \
        "$detalhe")"
      echo ok > "$arq_estado"
      rm -f "$arq_desde" "$arq_lembrete"
    fi
    return 0
  fi

  falhas=$(( falhas + 1 ))
  echo "$falhas" > "$arq_falhas"
  jm_log "FALHA ${falhas}/${FALHAS_PARA_ALERTAR}: $rotulo — $detalhe"

  if [ "$estado" != "caido" ] && [ "$falhas" -ge "$FALHAS_PARA_ALERTAR" ]; then
    echo caido > "$arq_estado"
    echo "$agora" > "$arq_desde"
    echo "$agora" > "$arq_lembrete"
    jm_telegram "$(printf '%s\n' \
      "Jardim Menu — CAIU: ${rotulo}" \
      "${detalhe}" \
      "Falhou ${falhas} vez(es) seguidas." \
      "O que fazer está em docs/operacao/MONITORAMENTO.md.")"
    return 0
  fi

  # Já avisado: no máximo um lembrete por MINUTOS_LEMBRETE. Repetir a cada
  # minuto faria a equipe silenciar o canal, e aí o próximo aviso de verdade
  # não chegaria em ninguém.
  if [ "$estado" = "caido" ] && [ "$MINUTOS_LEMBRETE" -gt 0 ]; then
    ultimo="$(cat "$arq_lembrete" 2>/dev/null || echo 0)"
    if [ $(( agora - ultimo )) -ge $(( MINUTOS_LEMBRETE * 60 )) ]; then
      echo "$agora" > "$arq_lembrete"
      desde="$(cat "$arq_desde" 2>/dev/null || echo "$agora")"
      tempo="$(jm_duracao $(( agora - desde )))"
      jm_telegram "$(printf '%s\n' \
        "Jardim Menu — AINDA FORA: ${rotulo}" \
        "Já são ${tempo}." \
        "${detalhe}")"
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
    usado="$(df -P "$ponto" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
    livre="$(df -Ph "$ponto" | awk 'NR==2 {print $4" livres de "$2}')"
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

# ---------------------------------------------------------------- rodada

for ambiente in $AMBIENTES; do
  verificar_ambiente "$ambiente"
done
verificar_disco

exit 0
