const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { PDFS_DIR } = require('./cleanupService');
const { generateReportHtml } = require('./templates/reportTemplate');

// Ruta ejecutable de Chromium
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || 
    (process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/chromium');

let browserInstance = null;
let renderCount = 0;
const MAX_RENDERS_BEFORE_RECYCLE = 50; // Reciclar periódicamente para evitar fugas de memoria en Chrome

/**
 * Obtiene o crea la instancia reutilizable del navegador Chromium
 */
async function getBrowser() {
    if (browserInstance && browserInstance.connected) {
        return browserInstance;
    }

    console.log(`[Puppeteer] Iniciando Chromium desde: ${CHROMIUM_PATH}`);
    browserInstance = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--no-first-run',
            '--disable-default-apps',
            '--hide-scrollbars',
            '--mute-audio'
        ]
    });

    browserInstance.on('disconnected', () => {
        console.warn('[Puppeteer] Instancia de Chromium desconectada.');
        browserInstance = null;
    });

    return browserInstance;
}

/**
 * Compila un documento HTML a PDF optimizado para A4
 * @param {string} htmlContent Contenido HTML completo
 * @param {string} outputFileName Nombre del archivo PDF (ej: Informe_OT-123.pdf)
 * @returns {Promise<{ pdfBuffer: Buffer, pdfPath: string, sizeMb: string }>}
 */
async function compileHtmlToPdf(htmlContent, outputFileName) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        // Optimizar viewport y emular medio de impresión
        await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
        await page.emulateMediaType('print');

        // Cargar HTML
        await page.setContent(htmlContent, {
            waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
            timeout: 60000
        });

        // Configuración de exportación PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: '<div style="font-size: 8px; color: #94a3b8; width: 100%; text-align: right; padding-right: 14mm; font-family: sans-serif;">Informe Técnico NetData PEX</div>',
            footerTemplate: '<div style="font-size: 8px; color: #64748b; width: 100%; display: flex; justify-content: space-between; padding: 0 14mm; font-family: sans-serif;"><span>Documento Técnico Oficial</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
            margin: {
                top: '14mm',
                bottom: '16mm',
                left: '10mm',
                right: '10mm'
            }
        });

        // Guardar archivo en disco para la política de retención (7 días)
        const safeName = (outputFileName || `Informe_${Date.now()}`).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        const finalPdfName = safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`;
        const pdfPath = path.join(PDFS_DIR, finalPdfName);

        fs.writeFileSync(pdfPath, pdfBuffer);

        const sizeMb = (pdfBuffer.length / (1024 * 1024)).toFixed(2);
        console.log(`[PDF] Compilado exitosamente: ${finalPdfName} (${sizeMb} MB)`);

        renderCount++;
        if (renderCount >= MAX_RENDERS_BEFORE_RECYCLE) {
            console.log('[Puppeteer] Reciclando proceso Chromium para optimizar memoria...');
            renderCount = 0;
            await browser.close().catch(() => {});
            browserInstance = null;
        }

        return {
            pdfBuffer,
            pdfPath,
            pdfFileName: finalPdfName,
            sizeMb
        };

    } finally {
        await page.close().catch(() => {});
    }
}

/**
 * Genera un PDF estructurado utilizando la plantilla moderna A4
 */
async function createStructuredReportPdf(reportData, outputFileName) {
    const html = generateReportHtml(reportData);
    return compileHtmlToPdf(html, outputFileName);
}

module.exports = {
    compileHtmlToPdf,
    createStructuredReportPdf
};
