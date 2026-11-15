FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node backend ./backend
COPY --chown=node:node frontend ./frontend
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173
ENV ASTRA_DB_PATH=/app/data/astra.sqlite
EXPOSE 4173
CMD ["node", "backend/server.mjs"]
