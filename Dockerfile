# =====================================================================
# DOCKERFILE: SERVIDOR DE INFORMES TÉCNICOS PDF
# Base: Node.js 20 Bookworm Slim con Chromium nativo optimizado
# =====================================================================

FROM node:20-bookworm-slim

# Evitar prompts interactivos durante apt
ENV DEBIAN_FRONTEND=noninteractive

# Omitir descarga interna de Chromium por parte de Puppeteer (usamos el del sistema)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=3394

# 1. Instalar Chromium, fuentes de alta legibilidad y utilidades esenciales
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-freefont-ttf \
    fonts-liberation \
    fonts-dejavu-core \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# 2. Crear directorio de la aplicación
WORKDIR /app

# 3. Copiar manifiestos e instalar dependencias de producción
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 4. Copiar código fuente
COPY src/ ./src/

# 5. Crear directorios de almacenamiento y ajustar permisos para usuario no-root
RUN mkdir -p /app/storage/images /app/storage/pdfs /app/storage/temp \
    && chown -R node:node /app

# 6. Cambiar al usuario sin privilegios 'node' por seguridad
USER node

# 7. Exponer puerto 3394
EXPOSE 3394

# 8. Verificación de salud periódica
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3394/health || exit 1

# 9. Comando de arranque
CMD ["node", "src/index.js"]
