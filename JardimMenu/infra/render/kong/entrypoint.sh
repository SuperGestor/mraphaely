#!/usr/bin/env bash
# Entrypoint do Kong do Jardim Menu no Render.
#
# Ele reproduz, dentro da imagem, o que o `entrypoint:` do infra/docker-compose.yml faz em
# uma linha:
#
#   bash -c 'eval "echo \"$$(cat ~/temp.yml)\"" > ~/kong.yml && /docker-entrypoint.sh kong docker-start'
#
# O kong.yml é um MODELO: as duas chaves do ambiente, o host do Realtime e as origens de
# CORS entram nele por expansão de variável de ambiente, na subida. Restrição do Render:
# sem bind mount, o modelo é assado na imagem (as variáveis continuam chegando de fora,
# pelo ambiente do serviço — nenhuma delas é assada).
#
# Três coisas mudam em relação à linha do compose, e cada uma tem motivo:
#   1. nada de `~`: no compose o contêiner roda como o usuário kong e o `~` resolve para
#      /home/kong. Aqui os caminhos são absolutos, para o arquivo ir para o mesmo lugar
#      independentemente de quem o Render usar para rodar o contêiner;
#   2. as variáveis do modelo são conferidas ANTES da expansão, e a falta de qualquer uma
#      para a subida (veja o porquê logo abaixo);
#   3. o Kong passa a escutar na porta que o Render entrega em PORT.

set -euo pipefail

MODELO=/home/kong/temp.yml
DESTINO=/home/kong/kong.yml

morrer() { echo "jardim-entrypoint: ERRO: $*" >&2; exit 1; }

[ -f "$MODELO" ] || morrer "o modelo $MODELO não está na imagem. Confira o COPY do Dockerfile."

# ---------------------------------------------------------------------------
# 1. Conferir as variáveis que o modelo usa.
#
# POR QUE ISTO NÃO É ZELO EXCESSIVO: a expansão troca variável vazia por nada, calada. Uma
# SUPABASE_ANON_KEY vazia vira `key:` sem valor; uma CORS_ORIGENS vazia vira
# `origins: []`. O Kong sobe, o Render marca o deploy como bem-sucedido, e a porta de
# entrada da API fica com o controle de acesso em estado que ninguém escolheu. Falha
# silenciosa é o pior defeito possível neste projeto: melhor não subir.
#
# A lista sai do próprio modelo, e não de um rol escrito aqui: assim, no dia em que alguém
# usar uma variável nova no kong.yml, a conferência acompanha sozinha.
# ---------------------------------------------------------------------------
faltando=()
while IFS= read -r nome; do
  [ -n "$nome" ] || continue
  if [ -z "${!nome:-}" ]; then
    faltando+=("$nome")
  fi
done < <(grep -oE '\$[A-Za-z_][A-Za-z0-9_]*' "$MODELO" | tr -d '$' | sort -u)

if [ ${#faltando[@]} -gt 0 ]; then
  # Só os NOMES. O valor de SUPABASE_SERVICE_KEY nunca aparece em log.
  morrer "estas variáveis são usadas no kong.yml e chegaram vazias: ${faltando[*]}. Preencha-as na configuração do serviço no Render antes de subir."
fi

# ---------------------------------------------------------------------------
# 2. Expandir o modelo.
#
# É o mesmo truque do compose oficial do Supabase e do nosso: `eval` + `echo` trocam
# $SUPABASE_ANON_KEY e companhia pelo valor do ambiente. É por causa dele que o kong.yml
# não pode ter aspas duplas nem crase, nem dentro de comentário — o aviso está no cabeçalho
# do próprio kong.yml, e continua valendo.
# ---------------------------------------------------------------------------
eval "echo \"$(cat "$MODELO")\"" > "$DESTINO" || morrer "não consegui escrever $DESTINO"

# O arquivo expandido tem as duas chaves em claro, inclusive a service_role. Dentro do
# contêiner ele não precisa ser legível por mais ninguém.
chmod 0600 "$DESTINO" || morrer "não consegui restringir a permissão de $DESTINO"

# Rede de segurança contra o erro mudo: se a expansão devolvesse um arquivo vazio, o Kong
# subiria sem rota nenhuma e todo caminho da API responderia 404, o que parece problema de
# aplicação e não de configuração.
[ -s "$DESTINO" ] || morrer "$DESTINO saiu vazio da expansão"

# ---------------------------------------------------------------------------
# 3. A porta.
#
# Restrição do Render: um Web Service precisa atender na porta que chega em PORT (o padrão
# do Render é 10000), e não na 8000 que é o padrão do Kong. Quem termina TLS é a borda do
# Render, então aqui só há HTTP.
#
# Só definimos se ninguém já tiver definido KONG_PROXY_LISTEN na configuração do serviço:
# quem escreveu à mão manda.
# ---------------------------------------------------------------------------
if [ -z "${KONG_PROXY_LISTEN:-}" ] && [ -n "${PORT:-}" ]; then
  export KONG_PROXY_LISTEN="0.0.0.0:${PORT}"
fi

# ---------------------------------------------------------------------------
# 4. Entregar ao entrypoint original do Kong, sem mexer nos argumentos.
# ---------------------------------------------------------------------------
[ -x /docker-entrypoint.sh ] || morrer "/docker-entrypoint.sh não existe nesta imagem. A imagem base mudou de desenho; pare e olhe antes de subir."

exec /docker-entrypoint.sh "$@"
