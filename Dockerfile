FROM node:18-bullseye

# Install Chromium and required libraries for puppeteer/whatsapp-web.js
RUN apt-get update && apt-get install -y \
  chromium \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libdrm2 \
  libgbm1 \
  libxkbcommon0 \
  libgtk-3-0 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libu2f-udev \
  libvulkan1 \
  xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Point puppeteer-core to system Chromium and skip downloading
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Expose no port (CLI/bot app)
CMD ["npm", "start"]


