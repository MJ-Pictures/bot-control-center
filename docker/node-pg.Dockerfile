FROM node:22-alpine

# PostgreSQL-Treiber zentral im Image. Der Anwendungscode bleibt weiterhin read-only gemountet.
RUN mkdir -p /opt/bwk \
    && cd /opt/bwk \
    && npm init -y >/dev/null 2>&1 \
    && npm install --omit=dev pg@8.13.1 >/dev/null 2>&1 \
    && npm cache clean --force >/dev/null 2>&1

ENV NODE_PATH=/opt/bwk/node_modules
