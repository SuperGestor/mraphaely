# Kong do Jardim Menu no Render (Web Service — o ÚNICO serviço público da pilha).
#
# POR QUE ESTA IMAGEM EXISTE
#
# Restrição do Render: não existe bind mount. O infra/docker-compose.yml monta
# ./kong/kong.yml em /home/kong/temp.yml; aqui o arquivo precisa estar ASSADO na imagem.
# O que NÃO é assado são os valores: as duas chaves do ambiente, o host do Realtime e as
# origens de CORS continuam chegando pelo ambiente do serviço, e o entrypoint os expande
# dentro do modelo na subida — o mesmo truque do compose.
#
# CONTEXTO DE BUILD: JardimMenu/infra (e NÃO esta pasta), porque o modelo mora em
# infra/kong/kong.yml e é o MESMO arquivo que o compose usa — uma cópia só, sem chance de
# divergirem. Ou seja:
#
#   cd JardimMenu/infra && docker build -f render/kong/Dockerfile -t jardim-kong-render:local .
#
# Na configuração do serviço do Render: raiz do build = JardimMenu/infra,
# caminho do Dockerfile = JardimMenu/infra/render/kong/Dockerfile.
#
# NENHUM `ARG` É DECLARADO AQUI, E ISSO É PROPOSITAL. O Render transforma toda variável de
# ambiente do serviço em build arg automaticamente, e SUPABASE_SERVICE_KEY é uma delas. Um
# `ARG SUPABASE_SERVICE_KEY` gravaria o valor no histórico da imagem (`docker history`), o
# que a regra 4 do CLAUDE.md proíbe. Sem o ARG declarado, o build arg não é consumido e não
# entra em camada nenhuma. Por isso, inclusive, a versão da imagem base está escrita por
# extenso aqui embaixo, e não em variável.

# Versão fixada por decisão (NF-018: atualização controlada). Ela aparece também em
# VERSAO_KONG nos infra/ambientes/*.env.exemplo, que é o que o compose usa. As duas mudam
# juntas, e a troca passa por staging antes.
FROM kong:2.8.1

# A imagem oficial termina com `USER kong`. Para copiar arquivo e acertar dono é preciso
# voltar a root, e devolver depois — o Kong não roda como root nem aqui nem no compose.
USER root

# O modelo, com o mesmo nome e o mesmo caminho que o compose usa.
COPY kong/kong.yml /home/kong/temp.yml
COPY render/kong/entrypoint.sh /usr/local/bin/jardim-entrypoint.sh

# O chmod é um RUN de propósito: `COPY --chmod` exige BuildKit, e quem faz o build aqui
# pode ser o Render, a máquina de alguém no Windows (onde o modo do arquivo no git não
# manda) ou a esteira. Assim o bit de execução não depende de nenhum dos três.
#
# /home/kong precisa ser gravável pelo usuário kong: é lá que o entrypoint escreve o
# kong.yml expandido, em execução.
RUN chown -R kong:kong /home/kong \
 && chmod 0644 /home/kong/temp.yml \
 && chmod 0755 /usr/local/bin/jardim-entrypoint.sh

USER kong

# Configuração estrutural do Kong, a mesma do infra/docker-compose.yml. Fica assada porque
# não é segredo e porque esquecer qualquer uma delas na configuração do serviço quebra a
# API de um jeito difícil de ler. O ambiente do serviço no Render sobrepõe qualquer uma
# destas, se um dia for preciso.
#
# NADA DE SEGREDO AQUI. SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, REALTIME_HOST e
# CORS_ORIGENS são por ambiente e chegam pelo ambiente do serviço; o entrypoint para a
# subida se alguma vier vazia.
ENV KONG_DATABASE=off
ENV KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml
ENV KONG_PLUGINS=request-transformer,cors,key-auth,acl

# Sem SRV na ordem de busca de DNS. No compose isso existe porque o contêiner do Realtime
# tem ponto no nome (realtime-dev.<projeto>) e só resolve assim. No Render o nome interno
# do serviço pode não ter ponto, mas manter a ordem não custa nada e evita que o dia em que
# ele tiver volte a dar um erro de resolução que ninguém liga à causa.
ENV KONG_DNS_ORDER=LAST,A,CNAME

# Cabeçalho de resposta do GoTrue e do PostgREST passa fácil do buffer padrão do nginx.
ENV KONG_NGINX_PROXY_PROXY_BUFFER_SIZE=160k
ENV KONG_NGINX_PROXY_PROXY_BUFFERS="64 160k"

# Quem termina TLS e fala com o cliente é a borda do Render. Sem isto o Kong registraria o
# IP do balanceador da plataforma em vez do IP de quem chamou.
ENV KONG_TRUSTED_IPS=0.0.0.0/0,::/0
ENV KONG_REAL_IP_HEADER=X-Forwarded-For
ENV KONG_REAL_IP_RECURSIVE=on

ENTRYPOINT ["/usr/local/bin/jardim-entrypoint.sh"]

# O CMD precisa ser repetido: declarar ENTRYPOINT zera o CMD herdado da imagem base. É o
# mesmo comando que o entrypoint do compose passa ao /docker-entrypoint.sh do Kong.
CMD ["kong", "docker-start"]
