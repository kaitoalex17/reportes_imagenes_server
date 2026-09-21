# Servidor de Generación y Almacenamiento de Informes Técnicos PDF

Microservicio de alto rendimiento y bajo consumo diseñado para compilar informes técnicos fotográficos en formato PDF de alta fidelidad, con almacenamiento temporal estructurado y políticas de retención automáticas (15 días para fotografías y 7 días para documentos PDF).

Optimizado para su despliegue mediante **Docker y Portainer** en servidores Linux (equipos de 4 núcleos y 8 GB de memoria RAM), preparado para operar tras un proxy inverso **Nginx** con túnel o proxy DNS de **Cloudflare** en el puerto **3394**.

Repositorio oficial: [https://github.com/kaitoalex17/reportes_imagenes_server](https://github.com/kaitoalex17/reportes_imagenes_server)

---

## Características Principales

- **Bajo consumo de recursos:** Diseñado sobre `node:20-bookworm-slim` con Chromium nativo en modo headless, manteniendo un uso en reposo inferior a 120 MB de memoria RAM.
- **Políticas de retención y autolimpieza:**
  - Fotografías e imágenes de sesión: Almacenadas durante **15 días**.
  - Documentos PDF compilados: Almacenados durante **7 días**.
  - Purga automática programada diaria (cron) con liberación de espacio en disco.
- **Sincronización con Cloud Firestore:** Lee en tiempo real parámetros de configuración (días de retención, límites de tamaño, calidad y logos) desde el documento `configuracion/generadorImagenes`.
- **Diseño visual corporativo A4:** Maquetación con cabecera institucional (NetData u Olin), distintivos de metadatos (orden de trabajo, fecha, técnico), cuadrícula de fotografías con marco estilizado, etiquetas de conceptos técnicos y pie de página con paginación formal.
- **Compatibilidad con Nginx y Cloudflare:** Soporta cabeceras de proxy (`X-Forwarded-For`, `X-Forwarded-Proto`), CORS permisivo para subdominios y soporte para cargas pesadas multipart de hasta 150 MB.
- **Diagnóstico y Health Check:** Endpoint `/health` y `/api/ping` para comprobación previa de conectividad (pre-check gate) desde clientes web como PEX.

---

## Arquitectura de Directorios

```text
reportes_imagenes_server/
├── Dockerfile                   (Definición de imagen basada en Debian Slim + Chromium)
├── docker-compose.yml           (Plantilla de despliegue para Portainer Stacks)
├── package.json                 (Manifiesto de dependencias y scripts de Node.js)
├── .env.example                 (Plantilla de variables de entorno)
├── .gitignore                   (Exclusiones de Git)
├── README.md                    (Manual técnico y guía de despliegue)
├── src/
│   ├── index.js                 (Servidor HTTP Express, endpoints y middleware)
│   ├── pdfService.js            (Controlador de Chromium con Puppeteer-core)
│   ├── cleanupService.js        (Motor de retención y purga programada)
│   ├── firestoreService.js      (Sincronización REST con base de datos)
│   └── templates/
│       └── reportTemplate.js    (Plantilla HTML/CSS para informes A4)
└── storage/                     (Volumen persistente de archivos)
    ├── images/                  (Fotografías almacenadas por orden / 15 días)
    ├── pdfs/                    (Informes PDF generados / 7 días)
    └── temp/                    (Archivos de sesión temporal)
```

---

## Despliegue con Portainer (Recomendado)

### Paso 1: Crear el Stack en Portainer
1. Accede a tu panel de **Portainer**.
2. Ve a la sección **Stacks** y haz clic en **Add stack**.
3. Asigna un nombre al stack (por ejemplo: `reportes-pdf-server`).
4. Selecciona el método **Web editor** o **Repository**:
   - Si usas el **Web editor**, pega el contenido del archivo `docker-compose.yml`:

```yaml
version: '3.8'

services:
  reportes-pdf-server:
    image: kaitoalex17/reportes_imagenes_server:latest
    container_name: reportes_imagenes_server
    restart: unless-stopped
    ports:
      - "3394:3394"
    volumes:
      - /opt/reportes_pdf/storage:/app/storage
    environment:
      - NODE_ENV=production
      - PORT=3394
      - HOST=0.0.0.0
      - RETENTION_DAYS_IMAGES=15
      - RETENTION_DAYS_PDFS=7
      - CLEANUP_CRON_SCHEDULE=0 3 * * *
      - MAX_BODY_SIZE_MB=150
      - FIREBASE_PROJECT_ID=calculadora-olin
      - FIREBASE_CONFIG_COLLECTION=configuracion
      - FIREBASE_CONFIG_DOC=generadorImagenes
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 1536M
        reservations:
          cpus: '0.25'
          memory: 256M
```

### Paso 2: Crear el directorio de almacenamiento en el host
En la terminal de tu servidor Linux, crea la carpeta para persistencia de datos:

```bash
mkdir -p /opt/reportes_pdf/storage/images /opt/reportes_pdf/storage/pdfs /opt/reportes_pdf/storage/temp
chown -R 1000:1000 /opt/reportes_pdf/storage
chmod -R 775 /opt/reportes_pdf/storage
```

### Paso 3: Desplegar el Stack
Haz clic en **Deploy the stack**. Portainer iniciará el contenedor y comenzará a responder en el puerto `3394`.

---

## Configuración de Nginx (Reverse Proxy)

Para exponer el servicio con certificado SSL y conectarlo con tu subdominio oficial (`https://apimg.instala.net/`), añade el siguiente bloque de configuración en Nginx:

```nginx
# /etc/nginx/sites-available/apimg.instala.net.conf

server {
    listen 80;
    server_name apimg.instala.net;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name apimg.instala.net;

    # Certificados SSL (Let's Encrypt o Cloudflare Origin CA)
    ssl_certificate /etc/letsencrypt/live/apimg.instala.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/apimg.instala.net/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Límite de subida adaptado para lotes de fotos pesados
    client_max_body_size 150M;
    client_body_buffer_size 128k;

    # Tiempos de espera extendidos para compilaciones voluminosas
    proxy_connect_timeout 120s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:3394;
        proxy_http_version 1.1;

        # Cabeceras de Proxy e Identificación de Cliente
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Opciones de búfer
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
```

Habilita el sitio y recarga Nginx:
```bash
ln -s /etc/nginx/sites-available/apimg.instala.net.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## Configuración de Cloudflare

Si el tráfico pasa a través de Cloudflare hacia tu servidor:

1. **Registro DNS:**
   - Tipo: `A` o `CNAME`.
   - Nombre: `apimg` (en el dominio `instala.net`).
   - Contenido: IP pública de tu servidor Linux.
   - Proxy status: **Proxied** (nube naranja activada).

2. **Ajustes de SSL/TLS:**
   - Modo de cifrado: **Full (strict)** si tienes certificado en Nginx, o **Full**.

3. **Límite de subida de archivos (Client Upload Limits):**
   - En planes gratuitos, el límite de subida por petición es de **100 MB**. Las fotos redimensionadas por canvas en el cliente frontend PEX se comprimen previamente para asegurar que nunca superen este umbral.

4. **Túneles Cloudflare (Opcional si usas cloudflared):**
   ```yaml
   ingress:
     - hostname: apimg.instala.net
       service: http://localhost:3394
     - service: http_status:404
   ```

---

## Variables de Entorno

| Variable | Valor por Defecto | Descripción |
| :--- | :--- | :--- |
| `PORT` | `3394` | Puerto HTTP interno de escucha del servicio |
| `HOST` | `0.0.0.0` | Dirección IP de enlace |
| `RETENTION_DAYS_IMAGES` | `15` | Días que se conservan las fotografías de intervenciones |
| `RETENTION_DAYS_PDFS` | `7` | Días que se conservan los informes compilados en disco |
| `CLEANUP_CRON_SCHEDULE` | `0 3 * * *` | Frecuencia de la tarea de purga (3:00 AM diario) |
| `MAX_BODY_SIZE_MB` | `150` | Límite máximo de tamaño en el cuerpo de peticiones |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` | Ruta del binario de Chromium en Debian |
| `FIREBASE_PROJECT_ID` | `calculadora-olin` | Proyecto de Google Cloud Firestore para sincronización |

---

## Referencia de la API REST

### 1. Comprobación de Conectividad y Diagnóstico (Health Check)
Utilizado por el cliente web PEX para activar o desactivar el botón de subida.

```http
GET /health
GET /api/ping
```

**Ejemplo de respuesta (JSON):**
```json
{
  "status": "online",
  "service": "reportes-imagenes-server",
  "version": "1.0.0",
  "uptimeSeconds": 3420,
  "port": 3394,
  "retention": {
    "imagesDays": 15,
    "pdfsDays": 7
  },
  "storage": {
    "imagesCount": 18,
    "imagesTotalMb": "142.30",
    "pdfsCount": 9,
    "pdfsTotalMb": "38.50",
    "totalMb": "180.80"
  },
  "memoryUsageMb": {
    "rss": "85.2",
    "heapUsed": "41.6"
  }
}
```

---

### 2. Compilar y Guardar Informe PDF

```http
POST /api/crear-pdf
Content-Type: multipart/form-data
```

**Parámetros:**
- `html_content` (texto): Código HTML del informe con fotos en Base64 o URLs.
- `nombre_archivo` (texto): Identificador del informe (ej: `Informe_OT-40912`).
- `archivos fotográficos` (opcional): Archivos de imagen adjuntos.

**Respuesta:**
- Descarga binaria del PDF generado (`application/pdf`).
- Cabeceras añadidas:
  - `X-PDF-Path`: `/api/descargar-pdf/Informe_OT-40912.pdf`
  - `X-PDF-Size-MB`: `4.12`
  - `X-Retention-Days`: `Imagenes:15d, PDFs:7d`

**Ejemplo con cURL:**
```bash
curl -X POST https://apimg.instala.net/api/crear-pdf \
  -F "nombre_archivo=Informe_OT-40912" \
  -F "html_content=@reporte.html" \
  --output Informe_OT-40912.pdf
```

---

### 3. Descarga Directa de PDF Almacenado

```http
GET /api/descargar-pdf/:nombre
```

Permite recuperar un PDF generado con anterioridad dentro de la ventana de retención de 7 días.

---

### 4. Forzar Limpieza Manual de Almacenamiento

```http
POST /api/cleanup
```

Ejecuta la purga inmediata de todos los archivos cuyas marcas temporales excedan los límites de retención configurados.

---

## Organización de Imágenes y Registro en Cloud Firestore

### 1. Estructura de Carpetas por Número de Orden en el Servidor
Las fotografías procesadas se agrupan en una carpeta exclusiva identificada con el número de orden de trabajo (OT):

```text
storage/
└── images/
    └── OT-40912/
        ├── foto_01.jpg
        ├── foto_02.jpg
        ├── foto_03.jpg
        └── Informe_OT-40912.pdf
```
- Acceso directo vía URL: `https://apimg.instala.net/storage/images/OT-40912/foto_01.jpg`
- Las fotos y el PDF generado se conservan juntos en la carpeta de la orden durante la ventana de retención configurada (15 días para fotos y 7 días para el PDF).

### 2. Registro en Cloud Firestore (Debajo de `configuracion`)
Cada orden procesada se registra automáticamente en Cloud Firestore:

- **Colección raíz:** `configuracion`
- **Documento principal:** `ordenesImagenes` (resumen de última orden y fecha)
- **Subcolección:** `ordenes`
- **ID de documento:** `{numeroOrden}` (ej: `OT-40912`)

Campos registrados:
- `numeroOrden`: Identificador de la orden (ej: `OT-40912`).
- `carpeta`: Ruta interna (`storage/images/OT-40912`).
- `urlCarpeta`: Enlace HTTP público (`https://apimg.instala.net/storage/images/OT-40912`).
- `pdfGenerado`: Nombre del archivo compilado (`Informe_OT-40912.pdf`).
- `urlPdf`: URL de descarga (`https://apimg.instala.net/api/descargar-pdf/Informe_OT-40912.pdf`).
- `totalImagenes`: Número de fotografías del informe.
- `fechaCreacion`: Marca de tiempo ISO de creación.
- `fechaExpiracionImagenes`: Fecha límite tras los 15 días de retención.
- `fechaExpiracionPdf`: Fecha límite tras los 7 días de retención.
- `estado`: `activo`.

---

## Sincronización con el Panel PEX

La configuración de retención y límites se sincroniza automáticamente con la página de administración:
- Ruta en el portal: `PEX/imagenes_generador_seting.html`
- Colección en Firestore: `configuracion`
- Documento: `generadorImagenes`

Cualquier cambio realizado en el panel web respecto a la retención o compresión será leído y aplicado por el servidor sin necesidad de reiniciar el contenedor.

---

## Licencia y Mantenimiento

Desarrollado para el ecosistema de herramientas técnicas NetData PEX. Licencia MIT.
