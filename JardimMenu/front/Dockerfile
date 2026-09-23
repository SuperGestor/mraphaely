# Imagem do app Next.js do Jardim Menu.
#
# Contexto principal: JardimMenu/front (por isso o .dockerignore desta pasta vale).
# Contexto nomeado `back`: JardimMenu/back, o MVC só de servidor que fica fora do front
# (D33) e que o next.config.ts importa com `experimental.externalDir`.
#
#   docker build -t jardim-menu-app:staging \
#     --build-context back=../back \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     -f Dockerfile .
#
# Na prática quem constrói é infra/scripts/publicar.sh, pelo compose, que já passa os
# dois contextos e os build args do ambiente.
#
# IMPORTANTE: as NEXT_PUBLIC_ entram no bundle do navegador no BUILD, e não na subida.
# Por isso cada ambiente tem a sua imagem: a imagem de staging aponta para a API de
# staging para sempre. Trocar a URL exige construir de novo, nunca só reiniciar.
#
# A service_role NÃO entra aqui de jeito nenhum: ela é variável de execução, entregue
# pelo compose, e nunca build arg, porque build arg fica gravado no histórico da imagem
# (regra 4 do CLAUDE.md, §4 regra 3 dos requisitos).

# Debian slim, e não Alpine: o upload de foto usa sharp (back/controllers/fotos.ts), e o
# binário pré-compilado de glibc é o caminho testado do pacote.
FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
# 1. Dependências. Camada própria para o cache sobreviver a mudança de código.
# ---------------------------------------------------------------------------
FROM base AS dependencias
WORKDIR /app/front
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# 2. Build. O back/ precisa estar em /app/back, um nível acima do front, que é onde o
#    tsconfig (`@back/*` -> `../back/*`) e o next.config o procuram.
# ---------------------------------------------------------------------------
FROM base AS construcao
WORKDIR /app/front
COPY --from=dependencias /app/front/node_modules ./node_modules
COPY --from=back . /app/back
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_DATA_SOURCE=supabase
ARG NEXT_PUBLIC_APP_ORIGIN
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_DATA_SOURCE=$NEXT_PUBLIC_DATA_SOURCE \
    NEXT_PUBLIC_APP_ORIGIN=$NEXT_PUBLIC_APP_ORIGIN \
    NODE_ENV=production

RUN npm run build

# ---------------------------------------------------------------------------
# 3. Execução. Só o standalone, sem node_modules de build e sem código fonte.
# ---------------------------------------------------------------------------
FROM base AS producao
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Usuário próprio, sem root e sem shell de login. O uid 1000 já é do usuário `node` da
# imagem oficial, então este usa 1001.
RUN groupadd --system --gid 1001 jardim \
 && useradd --system --uid 1001 --gid jardim --home-dir /app --shell /usr/sbin/nologin jardim

# O output standalone traz o server.js e só as dependências que o rastreamento provou
# necessárias. `.next/static` e `public/` ficam de fora dele e vêm à mão, como manda a
# documentação do Next.
COPY --from=construcao --chown=jardim:jardim /app/front/.next/standalone ./
COPY --from=construcao --chown=jardim:jardim /app/front/.next/static ./.next/static
COPY --from=construcao --chown=jardim:jardim /app/front/public ./public

USER jardim
EXPOSE 3000

# Sem `npm start`: o standalone tem servidor próprio, e um processo a menos significa
# que o sinal de parada chega direto no Node na hora de publicar.
CMD ["node", "server.js"]
