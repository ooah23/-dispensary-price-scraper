FROM node:20-slim
WORKDIR /app

# Only copy what the server actually needs — no npm install required
# serve-ui.mjs uses only built-in Node.js modules (http, fs, path)
COPY serve-ui.mjs ./
COPY public/ ./public/
COPY output/ ./output/
COPY logs/.gitkeep ./logs/

ENV PORT=3000
EXPOSE 3000

CMD ["node", "serve-ui.mjs"]
