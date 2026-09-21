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
const { getActiveConfig, registerOrderInFirestore } = require('./firestoreService');

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
    limits: { 
        fileSize: MAX_SIZE_MB * 1024 * 1024,
        fieldSize: MAX_SIZE_MB * 1024 * 1024
    }
});

// Servir estáticos para acceso directo a imágenes y PDFs de cada orden
app.use('/storage/images', express.static(IMAGES_DIR));
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
// RUTA DE EXPLORADOR DE MEDIAS ALMACENADAS (/api/media)
// =====================================================================

app.get('/api/media', async (req, res) => {
    try {
        const config = await getActiveConfig();
        const orders = [];

        if (fs.existsSync(IMAGES_DIR)) {
            const entries = fs.readdirSync(IMAGES_DIR, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const orderNum = entry.name;
                    const orderDirPath = path.join(IMAGES_DIR, orderNum);
                    try {
                        const orderFiles = fs.readdirSync(orderDirPath);
                        const imageFiles = orderFiles.filter(f => /\.(jpe?g|png|webp)$/i.test(f));
                        const pdfFile = orderFiles.find(f => f.toLowerCase().endsWith('.pdf')) || `Informe_${orderNum}.pdf`;
                        const pdfExistsInPdfsDir = fs.existsSync(path.join(PDFS_DIR, pdfFile));
                        const stat = fs.statSync(orderDirPath);

                        let metadata = null;
                        const metaPath = path.join(orderDirPath, 'metadata.json');
                        if (fs.existsSync(metaPath)) {
                            try {
                                metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                            } catch (e) {}
                        }

                        orders.push({
                            numeroOrden: orderNum,
                            carpeta: `storage/images/${orderNum}`,
                            urlCarpeta: `https://apimg.instala.net/storage/images/${orderNum}`,
                            totalImagenes: imageFiles.length,
                            imagenes: imageFiles.map(img => ({
                                nombre: img,
                                url: `https://apimg.instala.net/storage/images/${orderNum}/${img}`
                            })),
                            pdfGenerado: pdfFile,
                            urlPdf: `https://apimg.instala.net/api/descargar-pdf/${pdfFile}`,
                            pdfDisponible: pdfExistsInPdfsDir || fs.existsSync(path.join(orderDirPath, pdfFile)),
                            fechaCreacion: metadata?.fechaCreacion || stat.birthtime || stat.mtime,
                            metadata: metadata
                        });
                    } catch (readErr) {
                        console.warn(`[API] Error leyendo carpeta de orden ${orderNum}:`, readErr.message);
                    }
                }
            }
        }

        // Ordenar por fecha de creación más reciente
        orders.sort((a, b) => new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime());

        res.json({
            status: 'ok',
            totalOrdenes: orders.length,
            diasRetencionImagenes: config.diasRetencionImagenes,
            diasRetencionPdfs: config.diasRetencionPdfs,
            ordenes: orders
        });
    } catch (err) {
        console.error('[API] Error al listar medias:', err);
        res.status(500).json({ error: 'Error al listar las medias del servidor.', details: err.message });
    }
});

app.get('/api/media/:orderNumber', async (req, res) => {
    try {
        const orderNum = path.basename(req.params.orderNumber).trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
        const orderDirPath = path.join(IMAGES_DIR, orderNum);

        if (!fs.existsSync(orderDirPath)) {
            return res.status(404).json({ exists: false, error: 'Orden no encontrada en almacenamiento.' });
        }

        const files = fs.readdirSync(orderDirPath);
        const imageFiles = files.filter(f => /\.(jpe?g|png|webp)$/i.test(f));
        const pdfFile = files.find(f => f.toLowerCase().endsWith('.pdf')) || `Informe_${orderNum}.pdf`;

        let metadata = null;
        const metaPath = path.join(orderDirPath, 'metadata.json');
        if (fs.existsSync(metaPath)) {
            try {
                metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            } catch (e) {}
        }

        const stat = fs.statSync(orderDirPath);

        res.json({
            exists: true,
            numeroOrden: orderNum,
            totalImagenes: imageFiles.length,
            imagenes: imageFiles.map(img => ({
                nombre: img,
                url: `https://apimg.instala.net/storage/images/${orderNum}/${img}`
            })),
            pdfGenerado: pdfFile,
            urlPdf: `https://apimg.instala.net/api/descargar-pdf/${pdfFile}`,
            fechaCreacion: metadata?.fechaCreacion || stat.birthtime || stat.mtime,
            metadata: metadata
        });
    } catch (err) {
        console.error(`[API] Error obteniendo media de orden ${req.params.orderNumber}:`, err);
        res.status(500).json({ error: 'Error al consultar la orden.', details: err.message });
    }
});

// =====================================================================
// RUTA PRINCIPAL: /api/crear-pdf
// Compatible con procesado-imagen-v3.html y el servidor original
// =====================================================================

const handleCreatePdf = async (req, res) => {
    const startTime = Date.now();
    const config = await getActiveConfig();

    try {
        const { html_content, nombre_archivo, report_data, numero_orden } = req.body;
        const sessionStamp = Date.now();
        const baseName = (nombre_archivo || `Informe_${sessionStamp}`).replace(/[^a-zA-Z0-9_\-\.]/g, '_');

        // Extraer número de orden formal para organizar el almacenamiento en carpeta
        let rawOrder = numero_orden;
        if (!rawOrder && nombre_archivo) {
            rawOrder = nombre_archivo.replace(/^Informe_/i, '').replace(/_Parte\d+$/i, '');
        }
        const safeOrderNumber = String(rawOrder || 'OT_GENERAL').trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'OT_GENERAL';

        // 1. Crear carpeta exclusiva por número de orden para retención de fotos (15 días)
        const orderImageDir = path.join(IMAGES_DIR, safeOrderNumber);
        fs.mkdirSync(orderImageDir, { recursive: true });
        let savedImagesCount = 0;

        // Si vienen archivos multipart desde FormData
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imgExt = path.extname(file.originalname) || '.jpg';
                const imgPath = path.join(orderImageDir, `${file.fieldname}${imgExt}`);
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
            backupBase64ImagesFromHtml(html_content, orderImageDir).then(count => {
                if (count > 0) {
                    savedImagesCount += count;
                    console.log(`[Storage] Respaldadas ${count} fotos en la carpeta de la orden: ${orderImageDir}`);
                }
            }).catch(() => {});

        } else if (report_data) {
            // Modo JSON estructurado de alta fidelidad
            const parsedData = typeof report_data === 'string' ? JSON.parse(report_data) : report_data;
            pdfResult = await createStructuredReportPdf(parsedData, baseName);

        } else {
            return res.status(400).json({ error: 'Falta el campo requerido "html_content" o "report_data".' });
        }

        // Guardar copia del PDF dentro de la carpeta de la orden para que vayan acompañadas
        try {
            const pdfCopyInOrder = path.join(orderImageDir, pdfResult.pdfFileName);
            fs.copyFileSync(pdfResult.pdfPath, pdfCopyInOrder);
            fs.writeFileSync(path.join(orderImageDir, 'metadata.json'), JSON.stringify({
                numeroOrden: safeOrderNumber,
                pdfGenerado: pdfResult.pdfFileName,
                fechaCreacion: new Date().toISOString(),
                totalImagenes: savedImagesCount || 1
            }, null, 2));
        } catch (e) { /* ignorar */ }

        // Registrar la orden en Firestore justo debajo de configuracion/ordenesImagenes
        registerOrderInFirestore({
            numeroOrden: safeOrderNumber,
            carpeta: `storage/images/${safeOrderNumber}`,
            urlCarpeta: `https://apimg.instala.net/storage/images/${safeOrderNumber}`,
            pdfGenerado: pdfResult.pdfFileName,
            urlPdf: `https://apimg.instala.net/api/descargar-pdf/${pdfResult.pdfFileName}`,
            totalImagenes: savedImagesCount || 1,
            fechaCreacion: new Date().toISOString(),
            fechaExpiracionImagenes: new Date(Date.now() + (config.diasRetencionImagenes || 15) * 86400000).toISOString(),
            fechaExpiracionPdf: new Date(Date.now() + (config.diasRetencionPdfs || 7) * 86400000).toISOString()
        }).catch(err => console.warn('[Firestore] Error registrando orden:', err.message));

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
};

app.post(['/api/crear-pdf', '/'], upload.any(), handleCreatePdf);

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
