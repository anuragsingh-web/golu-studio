# Golu Studio for Render (and any Docker host).
# Node LTS + Chromium (GIF capture / H5 validation) + Cursor CLI (AI provider).
FROM node:lts-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    poppler-utils \
    fonts-liberation \
    fonts-noto-core \
    fonts-noto-color-emoji \
    ca-certificates \
    curl \
    bash \
  && rm -rf /var/lib/apt/lists/* \
  && CHROME_BIN="$(command -v chromium || command -v chromium-browser)" \
  && test -n "$CHROME_BIN" \
  && ln -sf "$CHROME_BIN" /usr/local/bin/chromium \
  && chromium --version

# Official Cursor CLI installer: https://cursor.com/docs/cli/installation
# Places `agent` and `cursor-agent` in ~/.local/bin; also symlink into /usr/local/bin.
RUN curl https://cursor.com/install -fsS | bash \
  && ln -sf /root/.local/bin/cursor-agent /usr/local/bin/cursor-agent \
  && ln -sf /root/.local/bin/agent /usr/local/bin/agent \
  && cursor-agent --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN rm -f .env

# Render injects $PORT at runtime. HOST must be 0.0.0.0 so the proxy can reach the app.
ENV PATH="/root/.local/bin:/root/.cursor/bin:/usr/local/bin:${PATH}" \
    HOST=0.0.0.0 \
    PORT=10000 \
    NO_OPEN=1 \
    AI_PROVIDER=cursor-agent \
    CURSOR_AGENT_TIMEOUT_MIN=25 \
    CHROME_PATH=/usr/local/bin/chromium \
    NODE_ENV=production

EXPOSE 10000
CMD ["npm", "start"]
