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

/**
 * Registra una orden procesada en Firestore bajo configuracion/ordenesImagenes/ordenes/{numeroOrden}
 * y actualiza el documento resumen configuracion/ordenesImagenes
 */
async function registerOrderInFirestore(orderData) {
    const {
        numeroOrden,
        carpeta,
        urlCarpeta,
        pdfGenerado,
        urlPdf,
        totalImagenes,
        fechaCreacion,
        fechaExpiracionImagenes,
        fechaExpiracionPdf
    } = orderData;

    if (!numeroOrden) return;

    try {
        const safeOrder = encodeURIComponent(numeroOrden);
        const orderDocUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}/ordenesImagenes/ordenes/${safeOrder}`;

        const payload = {
            fields: {
                numeroOrden: { stringValue: numeroOrden },
                carpeta: { stringValue: carpeta || `storage/images/${numeroOrden}` },
                urlCarpeta: { stringValue: urlCarpeta || `https://apimg.instala.net/storage/images/${numeroOrden}` },
                pdfGenerado: { stringValue: pdfGenerado || '' },
                urlPdf: { stringValue: urlPdf || '' },
                totalImagenes: { integerValue: String(totalImagenes || 0) },
                fechaCreacion: { timestampValue: fechaCreacion || new Date().toISOString() },
                fechaExpiracionImagenes: { timestampValue: fechaExpiracionImagenes || new Date(Date.now() + 15 * 86400000).toISOString() },
                fechaExpiracionPdf: { timestampValue: fechaExpiracionPdf || new Date(Date.now() + 7 * 86400000).toISOString() },
                estado: { stringValue: 'activo' }
            }
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(orderDocUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
            console.log(`[Firestore] Orden ${numeroOrden} registrada con éxito en ${COLLECTION}/ordenesImagenes/ordenes/`);
        } else {
            console.warn(`[Firestore] Aviso al registrar orden en Firestore (${res.status})`);
        }

        // Resumen en el documento configuracion/ordenesImagenes
        const parentDocUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}/ordenesImagenes?updateMask.fieldPaths=ultimaOrden&updateMask.fieldPaths=ultimaActualizacion`;
        await fetch(parentDocUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: {
                    ultimaOrden: { stringValue: numeroOrden },
                    ultimaActualizacion: { timestampValue: new Date().toISOString() }
                }
            })
        }).catch(() => {});

    } catch (err) {
        console.warn(`[Firestore] Error al registrar orden ${numeroOrden}:`, err.message);
    }
}

module.exports = {
    getActiveConfig,
    registerOrderInFirestore
};
