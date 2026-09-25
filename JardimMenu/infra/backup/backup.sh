#!/usr/bin/env bash
#
# Backup diário do Jardim Menu (NF-011: backup automático diário, com
# restauração testada e registrada antes da primeira subida).
#
# O que ele guarda, por ambiente:
#   1. o banco inteiro, em formato custom do pg_dump (-Fc), que é o formato que
#      o pg_restore consegue restaurar por partes e conferir sem restaurar;
#   2. os papéis do cluster (pg_dumpall --globals-only), pequenos e úteis quando
#      o Supabase é reinstalado do zero;
#   3. as fotos do Storage (bucket `produtos`), em tar.gz. Foto perdida é
#      trabalho do gestor perdido, e ela não está dentro do dump do banco;
#   4. um manifesto com a contagem das tabelas principais no momento do dump.
#      É contra esse número que a restauração se confere: sem ele, dizer que a
#      restauração deu certo é opinião.
#
# Depois guarda cópia FORA do servidor com rclone, apaga o que passou da
# retenção local e avisa no Telegram: sempre que falha, e uma vez por semana
# quando dá certo.
#
# Uso:
#   backup.sh [--ambiente NOME] [--somente-banco] [--sem-remoto]
#             [--config CAMINHO] [--simular]
#
# Roda sozinho pelo timer do systemd (systemd/jardim-backup.timer). A alternativa
# em cron está no README.md desta pasta.

set -euo pipefail

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/comum.sh
. "$DIR_SCRIPT/lib/comum.sh"

ARQUIVO_CONFIG="${JARDIM_BACKUP_ENV:-/etc/jardim-menu/backup.env}"
AMBIENTE_UNICO=""
SOMENTE_BANCO="nao"
SEM_REMOTO="nao"
SIMULAR="nao"

while [ $# -gt 0 ]; do
  case "$1" in
    --ambiente) AMBIENTE_UNICO="${2:-}"; shift 2 ;;
    --config) ARQUIVO_CONFIG="${2:-}"; shift 2 ;;
    --somente-banco) SOMENTE_BANCO="sim"; shift ;;
    --sem-remoto) SEM_REMOTO="sim"; shift ;;
    --simular) SIMULAR="sim"; shift ;;
    -h|--help) sed -n '2,27p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) jm_erro "Opção desconhecida: $1"; exit 2 ;;
  esac
done

jm_carregar_config "$ARQUIVO_CONFIG"

AMBIENTES="${AMBIENTES:-producao staging}"
[ -n "$AMBIENTE_UNICO" ] && AMBIENTES="$AMBIENTE_UNICO"

DIR_BACKUP="${DIR_BACKUP:-/var/backups/jardim-menu}"
DIR_TRAVA="${DIR_TRAVA:-/var/lock}"
DIAS_RETENCAO_LOCAL="${DIAS_RETENCAO_LOCAL:-14}"
DIAS_RETENCAO_REMOTO="${DIAS_RETENCAO_REMOTO:-0}"
DIAS_ENTRE_RESUMOS="${DIAS_ENTRE_RESUMOS:-7}"
# Piso da retenção local: quantos dumps mais novos ficam SEMPRE, por mais velhos que
# sejam. Existe porque a retenção por idade, sozinha, esvazia a pasta numa sequência de
# noites falhando: nenhum arquivo novo é gerado e, um dia, o último bom completa a idade
# de corte. Disco ocupado é problema menor do que pasta de backup vazia.
MINIMO_DUMPS_MANTIDOS="${MINIMO_DUMPS_MANTIDOS:-3}"
# Horas que a trava pode ficar presa antes de a sobreposição virar alarme. O systemd mata
# a rodada em TimeoutStartSec=3h, então trava presa muito além disso é processo solto
# (rodada manual, rclone pendurado) — e enquanto ela estiver de pé, nenhum backup roda.
HORAS_TRAVA_PRESA="${HORAS_TRAVA_PRESA:-6}"
# auth.users e storage.objects entram com o schema na frente, e não por capricho: são as
# contas da equipe e o registro das fotos, moram fora do public, e foram exatamente o que
# um backup aparentemente bom deixou de fora em 23/09/2026. Contadas aqui, a restauração
# compara e não tem como declarar "conferida" sem elas.
TABELAS_CONFERIDAS="${TABELAS_CONFERIDAS:-stores store_users categories products option_groups options product_option_groups tables devices table_sessions table_tabs orders order_items menu_events auth.users storage.objects}"
DUMP_GLOBAIS="${DUMP_GLOBAIS:-sim}"
RCLONE_REMOTO="${RCLONE_REMOTO:-}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/jardim-menu/rclone.conf}"
RCLONE_OPCOES="${RCLONE_OPCOES:---transfers 4 --retries 3 --low-level-retries 10}"

# O disco de onde este script roda é descartável? No Render é: Cron Job NÃO pode ter disco,
# então DIR_BACKUP vive num sistema de arquivos que morre junto com o disparo. Isso muda
# duas coisas de verdade, e é por isso que precisa ser declarado em vez de adivinhado:
#   - a cópia externa deixa de ser a segunda via e passa a ser a ÚNICA. Rodada sem ela não
#     guardou nada em lugar nenhum, e terminar com "backup em dia" seria mentira;
#   - a retenção local e o piso de MINIMO_DUMPS_MANTIDOS não protegem coisa alguma: não há
#     arquivo de ontem para proteger.
ARMAZENAMENTO_LOCAL_EFEMERO="${ARMAZENAMENTO_LOCAL_EFEMERO:-nao}"

jm_exige_comandos curl tar find date awk flock sha256sum gzip

# Em MODO_BANCO=host quem dumpa é o cliente instalado aqui, e ele precisa existir e ser
# pelo menos da versão do servidor. Conferido ANTES da trava e de qualquer dump: no Render
# a imagem do Cron Job é montada por nós, e faltar postgresql-client é o tropeço da estreia.
PRECISA_CLIENTE_PG=nao
for ambiente_conf in $AMBIENTES; do
  if [ "$(jm_var_ambiente "$ambiente_conf" MODO_BANCO "${MODO_BANCO:-docker}")" = "host" ]; then
    PRECISA_CLIENTE_PG=sim
  fi
done
if [ "$PRECISA_CLIENTE_PG" = "sim" ]; then
  jm_exige_cliente_pg psql pg_dump pg_dumpall pg_restore \
    || { jm_erro "MODO_BANCO=host exige o cliente do Postgres aqui dentro."; exit 2; }
fi

# --sem-remoto com disco descartável é uma rodada que não guarda nada, e sai com 0. É
# exatamente a falha silenciosa que este projeto trata como a pior possível.
if [ "$ARMAZENAMENTO_LOCAL_EFEMERO" = "sim" ]; then
  if [ "$SEM_REMOTO" = "sim" ]; then
    jm_erro "--sem-remoto com ARMAZENAMENTO_LOCAL_EFEMERO=sim: o disco daqui morre com o"
    jm_erro "disparo, então esta rodada não guardaria o backup em lugar NENHUM."
    exit 2
  fi
  if [ -z "$RCLONE_REMOTO" ]; then
    jm_erro "RCLONE_REMOTO vazio com ARMAZENAMENTO_LOCAL_EFEMERO=sim: sem destino externo,"
    jm_erro "o backup seria escrito num disco que some no fim do disparo. Nada foi feito."
    exit 2
  fi
fi

# Número quebrado na configuração não pode derrubar a rodada nem, pior, virar retenção
# sem piso: corrige e diz em voz alta o que corrigiu.
case "$MINIMO_DUMPS_MANTIDOS" in
  ''|*[!0-9]*|0) jm_aviso "MINIMO_DUMPS_MANTIDOS='${MINIMO_DUMPS_MANTIDOS}' não serve; usando 3."; MINIMO_DUMPS_MANTIDOS=3 ;;
esac
case "$HORAS_TRAVA_PRESA" in
  ''|*[!0-9]*) jm_aviso "HORAS_TRAVA_PRESA='${HORAS_TRAVA_PRESA}' não serve; usando 6."; HORAS_TRAVA_PRESA=6 ;;
esac

mkdir -p "$DIR_BACKUP" "$DIR_TRAVA"

TRAVA="$DIR_TRAVA/jardim-backup.lock"
MARCA_TRAVA="$DIR_TRAVA/jardim-backup.iniciada"

# Uma rodada de cada vez. Se a de ontem ainda estiver rodando (dump grande,
# rede ruim), a de hoje sai sem fazer nada; duas ao mesmo tempo só brigariam
# por disco e por banda.
#
# `9<>` e não `9>`: abrir com `>` TRUNCA o arquivo já na abertura, inclusive na rodada que
# NÃO consegue a trava. O carimbo de início vive em arquivo separado justamente por isso, e
# é ele que diz há quanto tempo a rodada anterior está presa.
exec 9<>"$TRAVA"
if ! flock -n 9; then
  presa_ha=0
  if [ -r "$MARCA_TRAVA" ]; then
    inicio_anterior="$(cat "$MARCA_TRAVA" 2>/dev/null || printf '0')"
    case "$inicio_anterior" in ''|*[!0-9]*) inicio_anterior=0 ;; esac
    [ "$inicio_anterior" -gt 0 ] && presa_ha=$(( $(date +%s) - inicio_anterior ))
  fi

  # Sair calado é razoável na primeira sobreposição, não quando a anterior está de pé há
  # horas: aí o backup de hoje simplesmente não aconteceu, e com `exit 0` o systemd dava a
  # rodada por boa e ninguém ficava sabendo. Silêncio é indistinguível de sucesso por uma
  # semana inteira, porque o resumo de "deu certo" só sai de sete em sete dias.
  if [ "$presa_ha" -gt $(( HORAS_TRAVA_PRESA * 3600 )) ]; then
    jm_erro "A rodada anterior está presa há $(( presa_ha / 3600 ))h: o backup de hoje NÃO rodou."
    jm_telegram "$(printf '%s\n' \
      "Jardim Menu — BACKUP NÃO RODOU ($(date '+%Y-%m-%d'))" \
      "A rodada anterior está presa há $(( presa_ha / 3600 ))h segurando ${TRAVA}." \
      "Nenhum backup novo foi gerado hoje, e nada novo subiu para o destino externo." \
      "" \
      "O que fazer: no servidor, 'ps -ef | grep backup.sh' e 'journalctl -u jardim-backup -n 50'." \
      "Mais em docs/operacao/BACKUP.md, seção 'Quando chega o aviso de falha'.")"
    exit 1
  fi

  jm_aviso "Outro backup ainda está rodando (há $(( presa_ha / 60 ))min). Saindo sem fazer nada."
  exit 0
fi
# Carimbo para a próxima rodada saber desde quando esta está de pé (ver o bloco acima).
date +%s > "$MARCA_TRAVA"

DATA_HORA="$(date '+%Y-%m-%dT%H%M')"
DATA_DIA="$(date '+%Y-%m-%d')"
REGISTRO_RODADA="$(mktemp -t jardim-backup-XXXXXX.log)"
trap 'rm -f "$REGISTRO_RODADA"' EXIT

# Tudo que os passos imprimem vai para o registro da rodada e para a saída
# padrão (que o journald recolhe). O fim do registro é o que vai no aviso de
# falha: quem recebe o alerta no celular precisa ver o erro, não só "falhou".
exec > >(tee -a "$REGISTRO_RODADA") 2>&1

FALHAS=""
RESUMO=""

# --------------------------------------------------------------- passos

executar() {
  if [ "$SIMULAR" = "sim" ]; then
    jm_log "SIMULAÇÃO: $*"
    return 0
  fi
  "$@"
}

# Dump do banco em formato custom. O -Fc é o que o NF-011 pede na prática: dá
# para restaurar por partes e para listar o conteúdo sem restaurar nada.
# Promove o arquivo .parcial, e FALHA se não conseguir.
#
# Existe porque `mv` seguido de `jm_log` fazia o retorno da função ser o do jm_log, que é
# sempre 0. Como estes passos são chamados como condição de `if`, o `set -e` do topo não
# vale dentro deles: um mv que falha — disco cheio, sistema remontado só de leitura,
# permissão — passava por sucesso, o arquivo inexistente entrava na lista dos gerados, e a
# rodada terminava com "backup em dia" sem o arquivo existir.
mv_ou_falhar() {
  local de="$1" para="$2" ambiente="$3" oque="$4"
  if ! mv "$de" "$para"; then
    rm -f "$de"
    jm_erro "[$ambiente] não consegui guardar $oque em $para."
    return 1
  fi
}

dump_banco() {
  local ambiente="$1" destino="$2"
  local modo container user db host porta senha parcial
  modo="$(jm_var_ambiente "$ambiente" MODO_BANCO "${MODO_BANCO:-docker}")"
  user="$(jm_var_ambiente "$ambiente" PG_USER "${PG_USER:-supabase_admin}")"
  db="$(jm_var_ambiente "$ambiente" PG_DB "${PG_DB:-postgres}")"
  senha="$(jm_var_ambiente "$ambiente" PG_SENHA "")"
  container="$(jm_var_ambiente "$ambiente" CONTAINER_DB "")"
  host="$(jm_var_ambiente "$ambiente" PG_HOST "127.0.0.1")"
  porta="$(jm_var_ambiente "$ambiente" PG_PORTA "5432")"
  parcial="${destino}.parcial"

  jm_log "[$ambiente] pg_dump -Fc para $(basename "$destino")"
  if [ "$SIMULAR" = "sim" ]; then
    jm_log "SIMULAÇÃO: pg_dump de $ambiente"
    return 0
  fi

  if [ "$modo" = "docker" ]; then
    [ -n "$container" ] || { jm_erro "[$ambiente] falta ${ambiente^^}_CONTAINER_DB na configuração."; return 1; }
    # O cliente usado é o da própria imagem do Postgres 17.6, o que elimina
    # divergência de versão entre cliente do host e servidor.
    docker exec -i -e PGPASSWORD="$senha" "$container" \
      pg_dump -U "$user" -d "$db" -Fc -Z 6 > "$parcial" \
      || { rm -f "$parcial"; jm_erro "[$ambiente] pg_dump falhou."; return 1; }
  else
    PGPASSWORD="$senha" pg_dump -h "$host" -p "$porta" -U "$user" -d "$db" -Fc -Z 6 > "$parcial" \
      || { rm -f "$parcial"; jm_erro "[$ambiente] pg_dump falhou."; return 1; }
  fi

  # Só vira arquivo definitivo depois de o pg_restore conseguir ler o índice.
  # Dump truncado que ninguém abriu é o clássico do backup que não existe.
  local indice
  if [ "$modo" = "docker" ]; then
    indice="$(docker exec -i "$container" pg_restore --list < "$parcial" 2>/dev/null)" \
      || { rm -f "$parcial"; jm_erro "[$ambiente] o dump não passou no pg_restore --list: arquivo inválido."; return 1; }
  else
    indice="$(pg_restore --list "$parcial" 2>/dev/null)" \
      || { rm -f "$parcial"; jm_erro "[$ambiente] o dump não passou no pg_restore --list: arquivo inválido."; return 1; }
  fi

  # O dump PRECISA trazer auth.users e storage.objects. Ler o índice é o único jeito de
  # saber: quando o pg_dump roda com um papel que não enxerga esses schemas, ele não
  # falha, não avisa e devolve código 0 — só entrega um dump sem eles.
  #
  # Foi o que aconteceu em 23/09/2026, com PG_USER=postgres: o backup parecia perfeito, a
  # restauração no staging bateu todas as contagens do `public` e declarou "CONFERIDA", e
  # o garçom apagado não voltou. Num desastre de verdade, o cardápio voltaria e ninguém
  # da equipe conseguiria entrar.
  # Casamento em bash puro, sem cano. `printf ... | grep -q` não serve aqui: o grep -q sai
  # no primeiro acerto, o printf morre de SIGPIPE, e com `set -o pipefail` o pipeline
  # inteiro vira falha — ou seja, encontrar a tabela era registrado como não encontrar.
  local faltando=""
  case "$indice" in *"TABLE DATA auth users"*) ;; *) faltando="$faltando auth.users" ;; esac
  case "$indice" in *"TABLE DATA storage objects"*) ;; *) faltando="$faltando storage.objects" ;; esac
  if [ -n "$faltando" ]; then
    rm -f "$parcial"
    jm_erro "[$ambiente] o dump saiu SEM:$faltando. Quase sempre é o papel do banco: ${ambiente^^}_PG_USER precisa ser supabase_admin, que é o dono dos schemas auth e storage. Com 'postgres' o pg_dump omite os dois sem reclamar."
    return 1
  fi

  mv_ou_falhar "$parcial" "$destino" "$ambiente" "o dump do banco" || return 1
  jm_log "[$ambiente] dump pronto: $(jm_tamanho "$destino")"
}

# Papéis e privilégios do cluster. Pequeno, e é o que falta quando alguém
# reinstala o Supabase do zero e o restore reclama de role inexistente.
dump_globais() {
  local ambiente="$1" destino="$2"
  local modo container user senha host porta parcial conteudo
  modo="$(jm_var_ambiente "$ambiente" MODO_BANCO "${MODO_BANCO:-docker}")"
  user="$(jm_var_ambiente "$ambiente" PG_USER "${PG_USER:-supabase_admin}")"
  senha="$(jm_var_ambiente "$ambiente" PG_SENHA "")"
  container="$(jm_var_ambiente "$ambiente" CONTAINER_DB "")"
  host="$(jm_var_ambiente "$ambiente" PG_HOST "127.0.0.1")"
  porta="$(jm_var_ambiente "$ambiente" PG_PORTA "5432")"
  parcial="${destino}.parcial"

  jm_log "[$ambiente] pg_dumpall --globals-only"
  if [ "$SIMULAR" = "sim" ]; then return 0; fi

  # Este era o único passo que não conferia o que gerava, e a conta fechava contra nós de
  # três jeitos ao mesmo tempo: o `>` cria o arquivo antes de o pipeline rodar; o `mv` era
  # o último comando da função e era o status DELE que virava o retorno; e a função é
  # chamada como condição de `if`, o que desliga o `set -e` aqui dentro. Um pg_dumpall que
  # morria (contêiner reiniciando, senha errada) deixava um .gz válido e VAZIO, de 20
  # bytes, que ganhava sha256, subia para o destino externo e entrava no resumo como
  # "backup em dia". No dia do desastre é este arquivo que recria anon, authenticated,
  # service_role, supabase_storage_admin e supabase_auth_admin num Supabase reinstalado do
  # zero — e vazio ele não recria nada.
  if [ "$modo" = "docker" ]; then
    [ -n "$container" ] || { jm_erro "[$ambiente] falta ${ambiente^^}_CONTAINER_DB na configuração."; return 1; }
    if ! docker exec -i -e PGPASSWORD="$senha" "$container" \
        pg_dumpall -U "$user" --globals-only | gzip -6 > "$parcial"; then
      rm -f "$parcial"
      jm_erro "[$ambiente] pg_dumpall dos papéis falhou (ou o gzip não conseguiu gravar até o fim)."
      return 1
    fi
  else
    if ! PGPASSWORD="$senha" pg_dumpall -h "$host" -p "$porta" -U "$user" --globals-only \
        | gzip -6 > "$parcial"; then
      rm -f "$parcial"
      jm_erro "[$ambiente] pg_dumpall dos papéis falhou (ou o gzip não conseguiu gravar até o fim)."
      return 1
    fi
  fi

  # Abrir o arquivo é o que prova que ele presta: gzip truncado por disco cheio sai daqui
  # com erro. É de propósito que não há `zgrep -q`/`| grep -q`: o grep -q sai no primeiro
  # acerto, o gzip morre de SIGPIPE e, com `set -o pipefail`, o pipeline inteiro vira
  # falha — ou seja, encontrar o papel seria registrado como não encontrar. Já tivemos
  # esse defeito aqui; o casamento é em bash puro, como no dump do banco.
  conteudo="$(gzip -dc "$parcial" 2>/dev/null)" || {
    rm -f "$parcial"
    jm_erro "[$ambiente] o arquivo de papéis saiu corrompido ou truncado: o gzip não conseguiu abrir de volta."
    return 1
  }
  case "$conteudo" in
    *"CREATE ROLE"*) ;;
    *)
      rm -f "$parcial"
      jm_erro "[$ambiente] o pg_dumpall não trouxe nenhum CREATE ROLE: sem os papéis, o arquivo não serve para nada. Confira ${ambiente^^}_PG_USER e ${ambiente^^}_PG_SENHA."
      return 1
      ;;
  esac

  mv_ou_falhar "$parcial" "$destino" "$ambiente" "o arquivo de papéis" || return 1
  jm_log "[$ambiente] papéis guardados: $(jm_tamanho "$destino")"
}

# Fotos do Storage. TRÊS caminhos, escolhidos por jm_modo_storage (lib/comum.sh):
#  - host:   <AMB>_DIR_STORAGE, caminho no host (o volume montado). Mais simples.
#  - docker: <AMB>_CONTAINER_STORAGE + <AMB>_CAMINHO_STORAGE, tar de dentro do contêiner.
#  - api:    <AMB>_STORAGE_URL + <AMB>_STORAGE_BUCKET + <AMB>_SERVICE_KEY, por HTTP.
#
# O modo `api` nasceu do Render, onde nenhum dos dois primeiros existe: Cron Job não
# enxerga disco e não há `docker exec`. O padrão continua sendo `auto`, que escolhe entre
# host e docker exatamente como antes — a máquina de quem desenvolve e a esteira não mudam.
#
# O TAR DO MODO api TEM OUTRO FORMATO, de propósito, e isso precisa ficar dito em voz alta:
# ele tem <bucket>/<caminho-do-objeto>, montado a partir da lista do banco, e NÃO é uma
# cópia da árvore de /var/lib/storage (que pode ter prefixo de tenant, arquivo de controle
# e o que mais o storage-api resolver guardar lá). Extrair um por cima do outro devolveria
# fotos em lugar errado, em silêncio. Por isso vai um marcador na raiz do tar, e é ele que
# o restaurar.sh lê para recusar a troca em vez de adivinhar.
dump_storage() {
  local ambiente="$1" destino="$2"
  local modo dir container caminho
  modo="$(jm_modo_storage "$ambiente")"
  dir="$(jm_var_ambiente "$ambiente" DIR_STORAGE "")"
  container="$(jm_var_ambiente "$ambiente" CONTAINER_STORAGE "")"
  caminho="$(jm_var_ambiente "$ambiente" CAMINHO_STORAGE "/var/lib/storage")"

  case "$modo" in
    host)
      jm_log "[$ambiente] fotos do Storage a partir do host: $dir"
      # A conferência vem ANTES do desvio de --simular: pasta errada na configuração é
      # justamente o que uma simulação existe para encontrar, e uma simulação que passa por
      # cima disso diz que está tudo bem para uma rodada que falharia de noite.
      [ -d "$dir" ] || { jm_erro "[$ambiente] ${ambiente^^}_DIR_STORAGE='$dir' não é uma pasta."; return 1; }
      if [ "$SIMULAR" = "sim" ]; then return 0; fi
      tar -C "$dir" -czf "${destino}.parcial" . \
        || { rm -f "${destino}.parcial"; return 1; }
      ;;
    docker)
      jm_log "[$ambiente] fotos do Storage de dentro do contêiner $container:$caminho"
      if [ "$SIMULAR" = "sim" ]; then return 0; fi
      docker exec -i "$container" tar -C "$caminho" -cf - . | gzip -6 > "${destino}.parcial" \
        || { rm -f "${destino}.parcial"; return 1; }
      ;;
    api)
      dump_storage_api "$ambiente" "$destino" || return 1
      if [ "$SIMULAR" = "sim" ]; then return 0; fi
      ;;
    *)
      # Falha, e não aviso. Foto perdida é trabalho do gestor perdido, e ela não está dentro
      # do dump do banco: uma rodada sem as fotos não é um backup completo, e declarar sucesso
      # faz a casa acreditar que está protegida. Quem quiser mesmo só o banco tem
      # --somente-banco, que é explícito e não passa por aqui.
      jm_erro "[$ambiente] Storage não configurado (${ambiente^^}_DIR_STORAGE, ${ambiente^^}_CONTAINER_STORAGE ou ${ambiente^^}_MODO_STORAGE=api). As fotos NÃO entraram neste backup."
      return 1
      ;;
  esac

  mv_ou_falhar "${destino}.parcial" "$destino" "$ambiente" "as fotos do Storage" || return 1
  jm_log "[$ambiente] fotos guardadas: $(jm_tamanho "$destino")"
}

# Fotos pela API do Storage. Escreve em "${destino}.parcial"; quem chamou promove.
dump_storage_api() {
  local ambiente="$1" destino="$2"
  local url bucket chave conf temporaria esperadas baixadas=0 falhou=0 nome

  url="$(jm_var_ambiente "$ambiente" STORAGE_URL "")"
  bucket="$(jm_var_ambiente "$ambiente" STORAGE_BUCKET "${STORAGE_BUCKET:-produtos}")"
  chave="$(jm_var_ambiente "$ambiente" SERVICE_KEY "")"
  url="${url%/}"

  [ -n "$url" ]   || { jm_erro "[$ambiente] falta ${ambiente^^}_STORAGE_URL (MODO_STORAGE=api)."; return 1; }
  [ -n "$chave" ] || { jm_erro "[$ambiente] falta ${ambiente^^}_SERVICE_KEY (MODO_STORAGE=api)."; return 1; }

  jm_log "[$ambiente] fotos do Storage pela API: $url, bucket '$bucket'"
  if [ "$SIMULAR" = "sim" ]; then return 0; fi

  # A lista sai do banco, e é ela que diz quantas fotos ESPERAMOS. Sem esse número, uma
  # rodada que baixasse metade sairia com um tar válido e menor, e ninguém veria.
  local lista
  lista="$(jm_storage_listar_do_banco "$ambiente" "$bucket")" \
    || { jm_erro "[$ambiente] não consegui ler storage.objects para listar as fotos."; return 1; }
  esperadas="$(printf '%s\n' "$lista" | grep -c . || true)"

  if [ "$esperadas" -eq 0 ]; then
    # Bucket vazio é possível (loja nova). Não é falha, mas é dito: um bucket que ESVAZIOU
    # sem ninguém mandar esvaziar tem a mesma cara, e o número no resumo denuncia.
    jm_aviso "[$ambiente] o bucket '$bucket' não tem nenhuma foto registrada em storage.objects."
  fi

  temporaria="$(mktemp -d -t jardim-fotos-XXXXXX)" || return 1
  conf="$(jm_storage_conf_curl "$chave")" || { rm -rf "$temporaria"; return 1; }
  # A chave do service_role está dentro do arquivo do curl. Ele tem de sumir em TODA saída
  # daqui, e por isso a limpeza é explícita em cada caminho: `trap ... RETURN` não é
  # herdado por função sem `set -o functrace`, e o que parece proteger e não protege é pior
  # do que não ter nada.
  limpar_api() { rm -f "$conf"; rm -rf "$temporaria"; }

  while IFS= read -r nome; do
    [ -n "$nome" ] || continue
    if jm_storage_baixar "$url" "$bucket" "$nome" "$temporaria/$bucket/$nome" "$conf"; then
      baixadas=$((baixadas + 1))
    else
      falhou=$((falhou + 1))
    fi
  done <<< "$lista"

  if [ "$falhou" -gt 0 ]; then
    jm_erro "[$ambiente] $falhou de $esperadas fotos NÃO baixaram. Backup de fotos incompleto não é backup: nada foi guardado."
    limpar_api
    return 1
  fi

  # O marcador. É o que impede um tar do modo api de ser extraído por cima de um
  # /var/lib/storage achando que são a mesma coisa.
  {
    printf 'modo=api\n'
    printf 'bucket=%s\n' "$bucket"
    printf 'objetos=%s\n' "$baixadas"
    printf 'origem=%s\n' "$url"
    printf 'gerado_em=%s\n' "$(jm_agora)"
    printf '# As entradas deste tar sao <bucket>/<caminho do objeto>, montadas a partir de\n'
    printf '# storage.objects. NAO e uma copia da arvore de /var/lib/storage: restaure com\n'
    printf '# restaurar.sh em MODO_STORAGE=api, que envia foto por foto pela API.\n'
  } > "$temporaria/$MARCADOR_STORAGE"

  if ! tar -C "$temporaria" -czf "${destino}.parcial" .; then
    rm -f "${destino}.parcial"
    limpar_api
    return 1
  fi
  jm_log "[$ambiente] $baixadas de $esperadas fotos baixadas do bucket '$bucket'"
  limpar_api
}

# Manifesto: contagem das tabelas principais no instante do dump. A restauração
# compara contra este arquivo, e é isso que transforma "restaurei" em prova.
manifesto_contagens() {
  local ambiente="$1" destino="$2"
  jm_log "[$ambiente] contando as tabelas principais"
  if [ "$SIMULAR" = "sim" ]; then return 0; fi
  jm_contagens "$ambiente" "$TABELAS_CONFERIDAS" > "${destino}.parcial" \
    || { rm -f "${destino}.parcial"; return 1; }
  mv_ou_falhar "${destino}.parcial" "$destino" "$ambiente" "o manifesto de contagens" || return 1
  sed 's/^/    /' "$destino"
}

# Cópia para fora do servidor. Backup que só existe no servidor não protege
# contra a perda do servidor: o NF-011 só está atendido com esta cópia de pé.
enviar_para_fora() {
  local ambiente="$1"; shift
  local arquivo
  if [ "$SEM_REMOTO" = "sim" ]; then
    jm_log "[$ambiente] --sem-remoto: cópia externa pulada (use só em teste)."
    return 0
  fi
  if [ -z "$RCLONE_REMOTO" ]; then
    jm_erro "[$ambiente] RCLONE_REMOTO vazio: a cópia FORA do servidor não aconteceu."
    return 1
  fi
  jm_exige_comandos rclone || return 1

  for arquivo in "$@"; do
    [ -f "$arquivo" ] || continue
    jm_log "[$ambiente] enviando $(basename "$arquivo") para $RCLONE_REMOTO/$ambiente/"
    # shellcheck disable=SC2086
    executar rclone --config "$RCLONE_CONFIG" $RCLONE_OPCOES \
      copyto "$arquivo" "$RCLONE_REMOTO/$ambiente/$(basename "$arquivo")" || return 1
  done

  case "$DIAS_RETENCAO_REMOTO" in
    ''|*[!0-9]*) ;;
    0) ;;
    *)
      jm_log "[$ambiente] apagando no destino externo o que passou de ${DIAS_RETENCAO_REMOTO} dias"
      # shellcheck disable=SC2086
      executar rclone --config "$RCLONE_CONFIG" $RCLONE_OPCOES \
        delete --min-age "${DIAS_RETENCAO_REMOTO}d" "$RCLONE_REMOTO/$ambiente" \
        || jm_aviso "[$ambiente] a limpeza do destino externo falhou; os arquivos novos já subiram."
      ;;
  esac
}

# Retenção local. Mantemos DIAS_RETENCAO_LOCAL dias no servidor; o histórico
# longo fica no destino externo (ou na regra de ciclo de vida do bucket, que é
# o lugar mais seguro para isso).
#
# Com um piso, e não só pela idade. O `find -mtime +N -delete` decide olhando a data e
# mais nada: numa sequência de noites falhando (senha rotacionada, nome de contêiner
# mudado depois de uma republicação) nenhum arquivo novo é gerado, nada novo sobe para o
# destino externo, e chega o dia em que o último backup BOM completa a idade de corte e é
# apagado — pasta local vazia e cópia externa parada há duas semanas. Por isso os
# MINIMO_DUMPS_MANTIDOS dumps mais novos ficam sempre, junto dos arquivos irmãos do mesmo
# horário: dump sem o .contagens.tsv não tem como ser conferido na restauração, e sem o
# .globais.sql.gz não recria os papéis.
limpar_antigos() {
  local ambiente="$1" dir="$2"
  local dumps=() protegidos=() candidatos=() arquivo prefixo manter
  local quantos=0

  # Ordenados do mais novo para o mais velho pela data de modificação.
  # Sem 2>/dev/null: esta consulta monta a lista do que NÃO pode ser apagado. Se ela
  # falhar calada — pasta ilegível, find sem -printf — o piso da retenção some e a
  # limpeza fica livre para esvaziar a pasta. Na dúvida, não se apaga nada.
  if ! mapfile -t dumps < <(
    find "$dir" -maxdepth 1 -type f -name 'jardim-*.dump' -printf '%T@\t%p\n' \
      | sort -rn | cut -f2-
  ); then
    jm_erro "[$ambiente] não consegui listar os dumps de $dir; nada foi apagado."
    return 1
  fi
  for arquivo in "${dumps[@]}"; do
    [ "$quantos" -lt "$MINIMO_DUMPS_MANTIDOS" ] || break
    protegidos+=("${arquivo%.dump}")
    quantos=$(( quantos + 1 ))
  done

  jm_log "[$ambiente] apagando backups locais com mais de ${DIAS_RETENCAO_LOCAL} dias (os ${MINIMO_DUMPS_MANTIDOS} dumps mais novos ficam, tenham a idade que tiverem)"

  mapfile -t candidatos < <(
    find "$dir" -maxdepth 1 -type f -name 'jardim-*' -mtime "+${DIAS_RETENCAO_LOCAL}" 2>/dev/null | sort
  )
  for arquivo in "${candidatos[@]}"; do
    manter="nao"
    for prefixo in "${protegidos[@]}"; do
      # As aspas em "$prefixo" são o que torna o prefixo literal; o `.*` é que é padrão,
      # e é ele que segura os irmãos (.dump, .contagens.tsv, .globais.sql.gz, .sha256).
      case "$arquivo" in
        "$prefixo".*) manter="sim"; break ;;
      esac
    done
    if [ "$manter" = "sim" ]; then
      jm_log "[$ambiente] mantido por ser um dos ${MINIMO_DUMPS_MANTIDOS} mais novos: $(basename "$arquivo")"
      continue
    fi
    jm_log "[$ambiente] apagando $(basename "$arquivo")"
    executar rm -f -- "$arquivo" || return 1
  done
}

# --------------------------------------------------------------- rodada

for ambiente in $AMBIENTES; do
  if ! jm_validar_ambiente "$ambiente"; then
    FALHAS="$FALHAS ${ambiente}(nome inválido)"
    continue
  fi

  dir_amb="$DIR_BACKUP/$ambiente"
  mkdir -p "$dir_amb"
  chmod 700 "$dir_amb" 2>/dev/null || true

  base="$dir_amb/jardim-${ambiente}-${DATA_HORA}"
  arq_dump="${base}.dump"
  arq_globais="${base}.globais.sql.gz"
  arq_storage="${base}.storage.tar.gz"
  arq_contagens="${base}.contagens.tsv"
  arq_soma="${base}.sha256"

  jm_log "=== [$ambiente] início da rodada de ${DATA_DIA} ==="
  erro_ambiente=""
  gerados=()

  if dump_banco "$ambiente" "$arq_dump"; then
    gerados+=("$arq_dump")
  else
    erro_ambiente="pg_dump"
  fi

  if [ -z "$erro_ambiente" ]; then
    if manifesto_contagens "$ambiente" "$arq_contagens"; then
      gerados+=("$arq_contagens")
    else
      erro_ambiente="contagem das tabelas"
    fi
  fi

  if [ -z "$erro_ambiente" ] && [ "$DUMP_GLOBAIS" = "sim" ]; then
    if dump_globais "$ambiente" "$arq_globais"; then
      gerados+=("$arq_globais")
    else
      jm_aviso "[$ambiente] pg_dumpall dos papéis falhou; o dump do banco continua de pé."
    fi
  fi

  if [ -z "$erro_ambiente" ] && [ "$SOMENTE_BANCO" = "nao" ]; then
    if dump_storage "$ambiente" "$arq_storage"; then
      [ -f "$arq_storage" ] && gerados+=("$arq_storage")
    else
      erro_ambiente="fotos do Storage"
    fi
  fi

  # Soma de verificação: é com ela que se descobre, meses depois, que o arquivo
  # mudou entre o servidor e o destino externo.
  if [ -z "$erro_ambiente" ] && [ "$SIMULAR" = "nao" ] && [ "${#gerados[@]}" -gt 0 ]; then
    nomes=()
    for arquivo_gerado in "${gerados[@]}"; do
      nomes+=("$(basename "$arquivo_gerado")")
    done
    if ( cd "$dir_amb" && sha256sum "${nomes[@]}" > "$arq_soma" ); then
      gerados+=("$arq_soma")
    else
      jm_aviso "[$ambiente] não consegui gerar o sha256."
    fi
  fi

  if [ -z "$erro_ambiente" ]; then
    if ! enviar_para_fora "$ambiente" "${gerados[@]}"; then
      erro_ambiente="cópia para fora do servidor"
    fi
  fi

  # A limpeza só roda quando a rodada deu certo. Antes ela rodava fora do `if`, em toda
  # rodada: a noite que falhava no pg_dump não gerava arquivo nenhum e, mesmo assim,
  # apagava por idade — enquanto o envio para fora, esse sim, só acontece em rodada boa.
  # Era a receita para a pasta esvaziar sozinha depois de duas semanas de falhas avisadas
  # e não atendidas.
  if [ -n "$erro_ambiente" ]; then
    jm_log "[$ambiente] limpeza dos antigos pulada: a rodada falhou em ${erro_ambiente}, e não se apaga backup bom numa noite que não gerou backup novo."
  elif [ "$ARMAZENAMENTO_LOCAL_EFEMERO" = "sim" ]; then
    # Não há o que limpar: o disco inteiro some no fim do disparo. Rodar a limpeza aqui só
    # imprimiria "apagando backups com mais de 14 dias" numa pasta que nasceu há dois
    # minutos — linha de log que faria alguém acreditar numa retenção local que não existe.
    jm_log "[$ambiente] sem limpeza local: o disco daqui é descartável, e o histórico mora em ${RCLONE_REMOTO}."
  else
    limpar_antigos "$ambiente" "$dir_amb" || jm_aviso "[$ambiente] a limpeza dos antigos falhou."
  fi

  if [ -n "$erro_ambiente" ]; then
    jm_erro "[$ambiente] rodada FALHOU em: $erro_ambiente"
    FALHAS="$FALHAS ${ambiente}(${erro_ambiente})"
  else
    linhas_total="$(awk -F'\t' '{s+=$2} END {print s+0}' "$arq_contagens" 2>/dev/null || echo '?')"
    RESUMO="${RESUMO}
• ${ambiente}: banco $(jm_tamanho "$arq_dump"), fotos $(jm_tamanho "$arq_storage"), ${linhas_total} linhas nas tabelas conferidas"
    jm_log "=== [$ambiente] rodada concluída ==="
  fi
done

# --------------------------------------------------------------- avisos

disco_livre="$(df -Ph "$DIR_BACKUP" | awk 'NR==2 {print $4" livres de "$2" ("$5" usado)"}')"

if [ -n "$FALHAS" ]; then
  trecho="$(tail -n 25 "$REGISTRO_RODADA")"
  jm_telegram "$(printf '%s\n' \
    "Jardim Menu — BACKUP FALHOU (${DATA_DIA})" \
    "Ambiente(s):${FALHAS}" \
    "Disco do backup: ${disco_livre}" \
    "" \
    "Fim do registro da rodada:" \
    "${trecho}" \
    "" \
    "O que fazer: docs/operacao/BACKUP.md, seção 'Quando chega o aviso de falha'.")"
  exit 1
fi

# Sucesso não enche o canal todo dia. Uma vez por semana o aviso confirma que a
# rotina está viva: silêncio total também é jeito de um backup morrer sem
# ninguém perceber.
marca="$(jm_dir_estado)/ultimo-resumo"
enviar_resumo="sim"
if [ -f "$marca" ]; then
  idade_dias=$(( ( $(date +%s) - $(stat -c %Y "$marca") ) / 86400 ))
  [ "$idade_dias" -lt "$DIAS_ENTRE_RESUMOS" ] && enviar_resumo="nao"
fi

# Com disco descartável o marcador nunca sobrevive de uma rodada para a outra, e o "uma vez
# por semana" vira "toda noite" sem ninguém ter escolhido isso. Não dá para consertar de
# dentro (não há onde guardar a marca), então o que se faz é DIZER: a mensagem passa a
# explicar por que chega todo dia, em vez de a equipe concluir sozinha que o backup
# enlouqueceu e silenciar o canal — que é como o próximo aviso de verdade não chega.
linha_retencao="Retenção local: ${DIAS_RETENCAO_LOCAL} dias · cópia externa: ${RCLONE_REMOTO:-NÃO CONFIGURADA}"
linha_frequencia="Esta confirmação sai a cada ${DIAS_ENTRE_RESUMOS} dia(s)."
if [ "$ARMAZENAMENTO_LOCAL_EFEMERO" = "sim" ]; then
  linha_retencao="Sem retenção local: o disco daqui morre com o disparo. A cópia que existe é ${RCLONE_REMOTO:-NÃO CONFIGURADA}."
  linha_frequencia="Esta confirmação sai em TODA rodada: sem disco, não há onde guardar a marca do último resumo."
fi

if [ "$enviar_resumo" = "sim" ]; then
  jm_telegram "$(printf '%s\n' \
    "Jardim Menu — backup em dia (${DATA_DIA})" \
    "Última rodada:${RESUMO}" \
    "" \
    "Disco do backup: ${disco_livre}" \
    "${linha_retencao}" \
    "${linha_frequencia}" \
    "Lembrete do NF-011: a restauração de teste se repete antes de cada fase que migra o banco.")"
  date > "$marca"
fi

jm_log "Backup concluído sem falhas. Disco: $disco_livre"
exit 0
