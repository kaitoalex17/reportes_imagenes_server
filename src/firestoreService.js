/**
 * Servicio de sincronización con Cloud Firestore (calculadora-olin)
 * Utiliza la API REST ligera de Firestore sin sobrecargar el contenedor con SDKs pesados
 */

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'calculadora-olin';
const COLLECTION = process.env.FIREBASE_CONFIG_COLLECTION || 'configuracion';
const DOC_NAME = process.env.FIREBASE_CONFIG_DOC || 'generadorImagenes';

const FIRESTORE_REST_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}/${DOC_NAME}`;

let cachedConfig = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos de caché

/**
 * Obtiene la configuración activa (desde caché, Firestore REST o variables de entorno)
 */
async function getActiveConfig(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedConfig && (now - lastFetchTime < CACHE_TTL_MS)) {
        return cachedConfig;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);

        const response = await fetch(FIRESTORE_REST_URL, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (response.ok) {
            const json = await response.json();
            const fields = json.fields || {};

            cachedConfig = {
                diasRetencionImagenes: extractNumber(fields.diasRetencionImagenes, Number(process.env.RETENTION_DAYS_IMAGES) || 15),
                diasRetencionPdfs: extractNumber(fields.diasRetencionPdfs, Number(process.env.RETENTION_DAYS_PDFS) || 7),
                servidorApi: extractString(fields.servidorApi, process.env.PUBLIC_API_URL || 'https://apimg.instala.net/api/crear-pdf'),
                calidadImagen: extractNumber(fields.calidadImagen, 0.85),
                logoPdf: extractString(fields.logoPdf, 'netdata'),
                maxImagenes: extractNumber(fields.maxImagenes, 25),
                maxTamanoMb: extractNumber(fields.maxTamanoMb, 9),
                maxDimensionPx: extractNumber(fields.maxDimensionPx, 1200),
                source: 'firestore_rest'
            };
            lastFetchTime = now;
            console.log('[Firestore] Configuración sincronizada desde Cloud Firestore');
            return cachedConfig;
        } else {
            console.warn(`[Firestore] Respuesta REST no OK (${response.status}). Usando fallback.`);
        }
    } catch (err) {
        console.warn(`[Firestore] No se pudo consultar Firestore (${err.message}). Usando configuración local.`);
    }

    // Fallback a variables de entorno o valores por defecto
    if (!cachedConfig) {
        cachedConfig = {
            diasRetencionImagenes: Number(process.env.RETENTION_DAYS_IMAGES) || 15,
            diasRetencionPdfs: Number(process.env.RETENTION_DAYS_PDFS) || 7,
            servidorApi: process.env.PUBLIC_API_URL || 'https://apimg.instala.net/api/crear-pdf',
            calidadImagen: 0.85,
            logoPdf: 'netdata',
            maxImagenes: 25,
            maxTamanoMb: 9,
            maxDimensionPx: 1200,
            source: 'environment_default'
        };
    }
    return cachedConfig;
}

function extractNumber(field, defaultVal) {
    if (!field) return defaultVal;
    if (field.integerValue !== undefined) return parseInt(field.integerValue, 10);
    if (field.doubleValue !== undefined) return parseFloat(field.doubleValue);
    if (typeof field === 'number') return field;
    return defaultVal;
}

function extractString(field, defaultVal) {
    if (!field) return defaultVal;
    if (field.stringValue !== undefined) return field.stringValue;
    if (typeof field === 'string') return field;
    return defaultVal;
}

module.exports = {
    getActiveConfig
};
