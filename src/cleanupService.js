const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// Rutas de almacenamiento
const STORAGE_DIR = path.resolve(__dirname, '..', 'storage');
const IMAGES_DIR = path.join(STORAGE_DIR, 'images');
const PDFS_DIR = path.join(STORAGE_DIR, 'pdfs');
const TEMP_DIR = path.join(STORAGE_DIR, 'temp');

// Asegurar existencia de directorios con tolerancia a fallos
[IMAGES_DIR, PDFS_DIR, TEMP_DIR].forEach(dir => {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (e) {
        console.warn(`[Storage] Aviso al inicializar directorio ${dir}:`, e.message);
    }
});

/**
 * Ejecuta la purga de archivos según las políticas de retención
 * @param {Object} options Parámetros de retención
 * @param {number} options.retentionDaysImages Días para conservar imágenes (ej. 15)
 * @param {number} options.retentionDaysPdfs Días para conservar PDFs (ej. 7)
 */
async function cleanStorage(options = {}) {
    const daysImages = Number(options.retentionDaysImages) || Number(process.env.RETENTION_DAYS_IMAGES) || 15;
    const daysPdfs = Number(options.retentionDaysPdfs) || Number(process.env.RETENTION_DAYS_PDFS) || 7;

    const now = Date.now();
    const cutoffImages = now - (daysImages * 24 * 60 * 60 * 1000);
    const cutoffPdfs = now - (daysPdfs * 24 * 60 * 60 * 1000);
    const cutoffTemp = now - (2 * 60 * 60 * 1000); // 2 horas para temporales

    let deletedImagesCount = 0;
    let deletedPdfsCount = 0;
    let freedBytes = 0;

    console.log(`[Limpieza] Iniciando purga programada (Retención: Imágenes ${daysImages}d, PDFs ${daysPdfs}d)...`);

    // 1. Limpiar imágenes expiradas en storage/images
    try {
        if (fs.existsSync(IMAGES_DIR)) {
            const entries = fs.readdirSync(IMAGES_DIR, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === '.gitkeep') continue;
                const fullPath = path.join(IMAGES_DIR, entry.name);

                if (entry.isDirectory()) {
                    // Si es una carpeta de sesión/orden
                    const stats = fs.statSync(fullPath);
                    if (stats.mtimeMs < cutoffImages) {
                        const dirSize = getDirSize(fullPath);
                        freedBytes += dirSize;
                        fs.rmSync(fullPath, { recursive: true, force: true });
                        deletedImagesCount++;
                        console.log(`[Limpieza] Carpeta de fotos eliminada: ${entry.name}`);
                    }
                } else if (entry.isFile()) {
                    const stats = fs.statSync(fullPath);
                    if (stats.mtimeMs < cutoffImages) {
                        freedBytes += stats.size;
                        fs.unlinkSync(fullPath);
                        deletedImagesCount++;
                        console.log(`[Limpieza] Foto eliminada: ${entry.name}`);
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Limpieza] Error limpiando directorio de imágenes:', err.message);
    }

    // 2. Limpiar PDFs expirados en storage/pdfs
    try {
        if (fs.existsSync(PDFS_DIR)) {
            const files = fs.readdirSync(PDFS_DIR);
            for (const file of files) {
                if (file === '.gitkeep') continue;
                const fullPath = path.join(PDFS_DIR, file);
                try {
                    const stats = fs.statSync(fullPath);
                    if (stats.isFile() && stats.mtimeMs < cutoffPdfs) {
                        freedBytes += stats.size;
                        fs.unlinkSync(fullPath);
                        deletedPdfsCount++;
                        console.log(`[Limpieza] PDF expirado eliminado: ${file}`);
                    }
                } catch (e) { /* ignorar archivos en uso */ }
            }
        }
    } catch (err) {
        console.error('[Limpieza] Error limpiando directorio de PDFs:', err.message);
    }

    // 3. Limpiar temporales mayores a 2 horas
    try {
        if (fs.existsSync(TEMP_DIR)) {
            const tempFiles = fs.readdirSync(TEMP_DIR);
            for (const item of tempFiles) {
                if (item === '.gitkeep') continue;
                const itemPath = path.join(TEMP_DIR, item);
                try {
                    const stats = fs.statSync(itemPath);
                    if (stats.mtimeMs < cutoffTemp) {
                        if (stats.isDirectory()) {
                            fs.rmSync(itemPath, { recursive: true, force: true });
                        } else {
                            fs.unlinkSync(itemPath);
                        }
                    }
                } catch (e) { /* ignorar */ }
            }
        }
    } catch (err) {
        console.error('[Limpieza] Error limpiando directorio temporal:', err.message);
    }

    const freedMb = (freedBytes / (1024 * 1024)).toFixed(2);
    console.log(`[Limpieza] Completada con éxito: ${deletedImagesCount} imágenes/lotes eliminados, ${deletedPdfsCount} PDFs eliminados, ${freedMb} MB liberados.`);

    return {
        success: true,
        deletedImagesCount,
        deletedPdfsCount,
        freedMb,
        timestamp: new Date().toISOString()
    };
}

/**
 * Obtiene el tamaño total de un directorio recursivamente
 */
function getDirSize(dirPath) {
    let size = 0;
    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const f of files) {
            const filePath = path.join(dirPath, f.name);
            if (f.isDirectory()) {
                size += getDirSize(filePath);
            } else if (f.isFile()) {
                size += fs.statSync(filePath).size;
            }
        }
    } catch (e) { /* ignorar */ }
    return size;
}

/**
 * Calcula estadísticas de almacenamiento actual
 */
function getStorageStats() {
    let totalImagesSize = 0;
    let imagesCount = 0;
    let totalPdfsSize = 0;
    let pdfsCount = 0;

    try {
        if (fs.existsSync(IMAGES_DIR)) {
            const list = fs.readdirSync(IMAGES_DIR);
            imagesCount = list.filter(f => f !== '.gitkeep').length;
            totalImagesSize = getDirSize(IMAGES_DIR);
        }
        if (fs.existsSync(PDFS_DIR)) {
            const list = fs.readdirSync(PDFS_DIR);
            const pdfFiles = list.filter(f => f.endsWith('.pdf'));
            pdfsCount = pdfFiles.length;
            for (const pf of pdfFiles) {
                totalPdfsSize += fs.statSync(path.join(PDFS_DIR, pf)).size;
            }
        }
    } catch (e) { /* ignorar */ }

    return {
        imagesCount,
        imagesTotalMb: (totalImagesSize / (1024 * 1024)).toFixed(2),
        pdfsCount,
        pdfsTotalMb: (totalPdfsSize / (1024 * 1024)).toFixed(2),
        totalMb: ((totalImagesSize + totalPdfsSize) / (1024 * 1024)).toFixed(2)
    };
}

/**
 * Inicia el cron scheduler de limpieza periódica
 */
function initCleanupScheduler(getConfigFn) {
    // Por defecto todos los días a las 03:00 AM (0 3 * * *)
    const scheduleExpr = process.env.CLEANUP_CRON_SCHEDULE || '0 3 * * *';

    if (cron.validate(scheduleExpr)) {
        cron.schedule(scheduleExpr, async () => {
            console.log(`[Cron] Ejecutando tarea de retención programada: ${scheduleExpr}`);
            const currentConfig = getConfigFn ? await getConfigFn() : {};
            await cleanStorage(currentConfig);
        });
        console.log(`[Limpieza] Tarea programada registrada: "${scheduleExpr}"`);
    } else {
        console.warn(`[Limpieza] Expresión cron inválida: "${scheduleExpr}". Usando intervalo de 12 horas.`);
        setInterval(async () => {
            const currentConfig = getConfigFn ? await getConfigFn() : {};
            await cleanStorage(currentConfig);
        }, 12 * 60 * 60 * 1000);
    }
}

function runCleanupManual() {
    return cleanStorage();
}

module.exports = {
    cleanStorage,
    getStorageStats,
    initCleanupScheduler,
    runCleanupManual,
    STORAGE_DIR,
    IMAGES_DIR,
    PDFS_DIR,
    TEMP_DIR
};
