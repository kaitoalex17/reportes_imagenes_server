require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { compileHtmlToPdf, createStructuredReportPdf } = require('./pdfService');
const { 
    cleanStorage, 
    getStorageStats, 
    initCleanupScheduler, 
    IMAGES_DIR, 
    PDFS_DIR 
} = require('./cleanupService');
const { getActiveConfig } = require('./firestoreService');

const app = express();
const PORT = process.env.PORT || 3394;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_SIZE_MB = Number(process.env.MAX_BODY_SIZE_MB) || 150;

// Configuración de Proxy (Nginx + Cloudflare)
app.set('trust proxy', 1);

// CORS abierto y cabeceras personalizadas
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Disposition', 'X-PDF-Path', 'X-PDF-Size-MB', 'X-Alerta-Tamano', 'X-Retention-Days']
}));

// Parsers JSON y URL-Encoded con límite ampliado
app.use(express.json({ limit: `${MAX_SIZE_MB}mb` }));
app.use(express.urlencoded({ limit: `${MAX_SIZE_MB}mb`, extended: true }));

// Configuración de Multer para recepción de archivos multipart
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 }
});

// Servir estáticos opcionales para acceso directo a imágenes y PDFs
app.use('/storage/pdfs', express.static(PDFS_DIR));

// =====================================================================
// RUTAS DE DIAGNÓSTICO Y SALUD (Para pre-check de procesado-imagen-v3)
// =====================================================================

app.get(['/', '/health', '/api/ping'], async (req, res) => {
    const config = await getActiveConfig();
    const stats = getStorageStats();
    const memory = process.memoryUsage();

    res.json({
        status: 'online',
        service: 'reportes-imagenes-server',
        version: '1.0.0',
        uptimeSeconds: Math.floor(process.uptime()),
        port: PORT,
        retention: {
            imagesDays: config.diasRetencionImagenes,
            pdfsDays: config.diasRetencionPdfs
        },
        storage: stats,
        memoryUsageMb: {
            rss: (memory.rss / (1024 * 1024)).toFixed(1),
            heapUsed: (memory.heapUsed / (1024 * 1024)).toFixed(1)
        },
        timestamp: new Date().toISOString()
    });
});

app.get('/api/config', async (req, res) => {
    const config = await getActiveConfig(req.query.refresh === 'true');
    res.json(config);
});

app.get('/api/stats', (req, res) => {
    res.json(getStorageStats());
});

app.post('/api/cleanup', async (req, res) => {
    const config = await getActiveConfig();
    const result = await cleanStorage(config);
    res.json(result);
});

app.get('/api/descargar-pdf/:nombre', (req, res) => {
    const safeName = path.basename(req.params.nombre);
    const filePath = path.join(PDFS_DIR, safeName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'El archivo PDF no existe o ha expirado por política de retención.' });
    }

    res.download(filePath, safeName);
});

// =====================================================================
// RUTA PRINCIPAL: /api/crear-pdf
// Compatible con procesado-imagen-v3.html y el servidor original
// =====================================================================

app.post('/api/crear-pdf', upload.any(), async (req, res) => {
    const startTime = Date.now();
    const config = await getActiveConfig();

    try {
        const { html_content, nombre_archivo, report_data } = req.body;
        const sessionStamp = Date.now();
        const baseName = (nombre_archivo || `Informe_${sessionStamp}`).replace(/[^a-zA-Z0-9_\-\.]/g, '_');

        // 1. Crear carpeta para retención de fotos (15 días) si vienen archivos o Base64
        const sessionImageDir = path.join(IMAGES_DIR, `${baseName}_${sessionStamp}`);
        let savedImagesCount = 0;

        // Si vienen archivos multipart desde FormData
        if (req.files && req.files.length > 0) {
            fs.mkdirSync(sessionImageDir, { recursive: true });
            for (const file of req.files) {
                const imgExt = path.extname(file.originalname) || '.jpg';
                const imgPath = path.join(sessionImageDir, `${file.fieldname}${imgExt}`);
                fs.writeFileSync(imgPath, file.buffer);
                savedImagesCount++;
            }
        }

        // 2. Determinar si es reporte estructurado o HTML directo
        let pdfResult = null;

        if (html_content) {
            // Modo HTML directo (usado por procesado-imagen-v3.html)
            pdfResult = await compileHtmlToPdf(html_content, baseName);

            // Extraer y respaldar imágenes en Base64 en disco para cumplir retención de 15 días
            backupBase64ImagesFromHtml(html_content, sessionImageDir).then(count => {
                if (count > 0) console.log(`[Storage] Respaldadas ${count} imágenes Base64 en: ${sessionImageDir}`);
            }).catch(() => {});

        } else if (report_data) {
            // Modo JSON estructurado de alta fidelidad
            const parsedData = typeof report_data === 'string' ? JSON.parse(report_data) : report_data;
            pdfResult = await createStructuredReportPdf(parsedData, baseName);

        } else {
            return res.status(400).json({ error: 'Falta el campo requerido "html_content" o "report_data".' });
        }

        // 3. Comprobar alerta de tamaño en MB
        const sizeMb = parseFloat(pdfResult.sizeMb);
        if (sizeMb > config.maxTamanoMb) {
            res.setHeader('X-Alerta-Tamano', `Supera los ${config.maxTamanoMb}MB`);
        }

        // 4. Cabeceras informativas y envío del archivo
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.pdfFileName}"`);
        res.setHeader('X-PDF-Path', `/api/descargar-pdf/${pdfResult.pdfFileName}`);
        res.setHeader('X-PDF-Size-MB', pdfResult.sizeMb);
        res.setHeader('X-Retention-Days', `Imagenes:${config.diasRetencionImagenes}d, PDFs:${config.diasRetencionPdfs}d`);

        console.log(`[API] Solicitud completada en ${Date.now() - startTime}ms. Archivo: ${pdfResult.pdfFileName}`);
        res.send(pdfResult.pdfBuffer);

    } catch (err) {
        console.error('[API] Error generando PDF:', err);
        res.status(500).json({ 
            error: 'Error interno del servidor al compilar el PDF.', 
            details: err.message 
        });
    }
});

/**
 * Función en segundo plano para extraer imágenes Base64 de un HTML y guardarlas en disco
 */
async function backupBase64ImagesFromHtml(htmlContent, targetDir) {
    const base64Regex = /data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)/g;
    let match;
    let index = 1;
    let createdDir = false;

    while ((match = base64Regex.exec(htmlContent)) !== null) {
        if (!createdDir) {
            fs.mkdirSync(targetDir, { recursive: true });
            createdDir = true;
        }
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const buffer = Buffer.from(match[2], 'base64');
        const imgPath = path.join(targetDir, `foto_${String(index).padStart(2, '0')}.${ext}`);
        fs.writeFileSync(imgPath, buffer);
        index++;
    }
    return index - 1;
}

// =====================================================================
// INICIALIZACIÓN Y SCHEDULER
// =====================================================================

app.listen(PORT, HOST, () => {
    console.log('====================================================');
    console.log(` SERVIDOR DE INFORMES PDF (Portainer + Nginx)`);
    console.log(` Escuchando en: http://${HOST}:${PORT}`);
    console.log(` Directorio de imágenes (15d): ${IMAGES_DIR}`);
    console.log(` Directorio de PDFs (7d): ${PDFS_DIR}`);
    console.log('====================================================');

    // Iniciar tarea programada de retención periódica
    initCleanupScheduler(getActiveConfig);
});
