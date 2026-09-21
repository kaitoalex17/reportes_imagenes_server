/**
 * Plantilla HTML/CSS para generación de Informes Técnicos Fotográficos
 * Diseño visual corporativo de alta fidelidad para formato A4
 */

function generateReportHtml(options) {
    const {
        orderNumber = 'S/N',
        date = new Date().toLocaleDateString('es-ES'),
        technician = '',
        notes = '',
        imagesPerPage = 2,
        includeIndex = false,
        logoBase64 = '',
        logoType = 'netdata',
        images = [],
        ocultarPieSinDescripcion = false,
        mostrarCoordenadas = true,
        mostrarFechaHora = true,
        mostrarNumeroFoto = true,
        colorAcento = '#2563eb'
    } = options;

    const brandName = logoType === 'olin' ? 'Olin Telecom' : 'NetData PEX';
    const isSingle = parseInt(imagesPerPage, 10) === 1;
    const accentColor = colorAcento || '#2563eb';

    // Construcción del documento
    let html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Informe Técnico - ${escapeHtml(orderNumber)}</title>
    <style>
        @page {
            size: A4 portrait;
            margin: 12mm 12mm 14mm 12mm;
        }

        *, *::before, *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #1e293b;
            background-color: #ffffff;
            font-size: 11px;
            line-height: 1.35;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        /* ── CABECERA DE PÁGINA ── */
        .page-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2.5px solid ${accentColor};
            padding-bottom: 8px;
            margin-bottom: 12px;
        }

        .header-logo-wrap img {
            max-height: 42px;
            width: auto;
            display: block;
        }

        .header-logo-fallback {
            font-size: 18px;
            font-weight: 800;
            color: ${accentColor};
            letter-spacing: -0.5px;
            text-transform: uppercase;
        }

        .header-meta {
            text-align: right;
        }

        .header-meta h1 {
            font-size: 15px;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: 0.3px;
            text-transform: uppercase;
            margin-bottom: 3px;
        }

        .meta-badges {
            display: flex;
            gap: 6px;
            justify-content: flex-end;
            align-items: center;
        }

        .badge {
            display: inline-block;
            padding: 2.5px 7px;
            border-radius: 4px;
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: 0.2px;
        }

        .badge-order {
            background-color: #eff6ff;
            color: #1d4ed8;
            border: 1px solid #bfdbfe;
        }

        .badge-date {
            background-color: #f8fafc;
            color: #475569;
            border: 1px solid #e2e8f0;
        }

        .badge-count {
            background-color: #f0fdf4;
            color: #15803d;
            border: 1px solid #bbf7d0;
        }

        /* ── CONTENEDOR DE FOTOS ── */
        .page-body {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .photo-card {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 8px 10px;
            display: flex;
            flex-direction: column;
            page-break-inside: avoid;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .photo-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
            padding-bottom: 4px;
            border-bottom: 1px solid #f1f5f9;
        }

        .photo-number {
            font-size: 10.5px;
            font-weight: 800;
            color: ${accentColor};
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .photo-timestamp {
            font-size: 9.5px;
            color: #64748b;
            font-weight: 600;
        }

        .photo-img-wrap {
            width: 100%;
            height: ${isSingle ? '510px' : '225px'};
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: #0b1120;
            border-radius: 6px;
            overflow: hidden;
        }

        .photo-img-wrap img {
            max-width: 100%;
            max-height: 100%;
            border-radius: 4px;
            object-fit: contain;
            display: block;
        }

        /* ── PIE DE TARJETA SPLIT (Descripción 60% / Satélite 40%) ── */
        .card-footer {
            display: flex;
            gap: 10px;
            margin-top: 8px;
            align-items: stretch;
        }

        .desc-card {
            flex: 1;
            min-width: 0;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-left: 4px solid ${accentColor};
            border-radius: 6px;
            padding: 6px 10px;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .desc-card.full-width {
            width: 100%;
        }

        .concept-title {
            font-size: 8px;
            font-weight: 800;
            color: ${accentColor};
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 2px;
        }

        .concept-text {
            font-size: 11px;
            font-weight: 600;
            color: #1e293b;
            line-height: 1.35;
            word-break: break-word;
        }

        .location-card {
            width: ${isSingle ? '220px' : '175px'};
            flex-shrink: 0;
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 6px;
            padding: 5px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
        }

        .location-card.full-width {
            width: 100%;
            flex-direction: row;
            gap: 12px;
            justify-content: flex-start;
            padding: 6px 10px;
            text-align: left;
        }

        .photo-map-preview {
            width: 100%;
            height: 70px;
            border-radius: 4px;
            object-fit: cover;
            border: 1px solid #cbd5e1;
            display: block;
        }

        .location-card.full-width .photo-map-preview {
            width: 120px;
            height: 65px;
            flex-shrink: 0;
        }

        .location-tag {
            font-size: 8px;
            font-weight: 800;
            color: #166534;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            margin-top: 3px;
        }

        .location-coords {
            font-size: 9.5px;
            font-weight: 700;
            color: #0f172a;
            white-space: nowrap;
            margin-top: 1px;
        }

        /* ── ÍNDICE FOTOGRÁFICO ── */
        .index-page {
            page-break-after: always;
        }

        .index-title {
            font-size: 16px;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 14px;
            padding-bottom: 6px;
            border-bottom: 1px solid #e2e8f0;
        }

        .index-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            margin-bottom: 20px;
        }

        .index-table th {
            background-color: ${accentColor};
            color: #ffffff;
            font-weight: 700;
            padding: 8px 10px;
            text-align: left;
        }

        .index-table td {
            padding: 7px 10px;
            border-bottom: 1px solid #e2e8f0;
        }

        .index-table tr:nth-child(even) {
            background-color: #f8fafc;
        }

        .page-break {
            page-break-after: always;
        }
    </style>
</head>
<body>`;

    const renderHeader = () => `
    <header class="page-header">
        <div class="header-logo-wrap">
            ${logoBase64 
                ? `<img src="${logoBase64}" alt="${brandName}">`
                : `<div class="header-logo-fallback">${brandName}</div>`
            }
        </div>
        <div class="header-meta">
            <h1>Informe Técnico Fotográfico</h1>
            <div class="meta-badges">
                <span class="badge badge-order">Orden: ${escapeHtml(orderNumber)}</span>
                <span class="badge badge-date">${escapeHtml(date)}</span>
                <span class="badge badge-count">${images.length} fotos</span>
            </div>
        </div>
    </header>`;

    // 1. Página de Índice Fotográfico (si se solicita)
    if (includeIndex && images.length > 0) {
        html += `<div class="index-page">`;
        html += renderHeader();
        html += `<h2 class="index-title">Índice de Fotografías de Mantenimiento</h2>`;
        html += `<table class="index-table">
            <thead>
                <tr>
                    <th style="width: 55px;">#</th>
                    <th>Concepto / Descripción Técnica</th>
                    <th style="width: 140px;">Fecha / Hora</th>
                    <th style="width: 70px; text-align: center;">Página</th>
                </tr>
            </thead>
            <tbody>`;

        images.forEach((img, idx) => {
            const pageOffset = includeIndex ? 2 : 1;
            const targetPage = Math.floor(idx / imagesPerPage) + pageOffset;
            const desc = img.description || 'Sin descripción';
            const timeStr = img.date || date;

            html += `<tr>
                <td style="font-weight: 700; color: #2563eb;">Foto ${idx + 1}</td>
                <td style="font-weight: 600; color: #0f172a;">${escapeHtml(desc)}</td>
                <td style="color: #64748b;">${escapeHtml(timeStr)}</td>
                <td style="text-align: center; font-weight: 700; color: #1d4ed8;">Pág. ${targetPage}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
    }

    // 2. Páginas con bloques de fotografías
    for (let i = 0; i < images.length; i += imagesPerPage) {
        const chunk = images.slice(i, i + imagesPerPage);
        const isLast = (i + imagesPerPage) >= images.length;

        html += `<div class="page-container">`;
        html += renderHeader();
        html += `<div class="page-body">`;

        chunk.forEach((img, subIdx) => {
            const globalIndex = i + subIdx + 1;
            const desc = (img.description || '').trim();
            const hasDesc = desc.length > 0 && desc !== 'Sin descripción' && desc !== 'Registro fotográfico de intervención';
            const timeStr = (mostrarFechaHora && img.date) ? `Captura: ${escapeHtml(img.date)}` : '';
            const showDescBox = !ocultarPieSinDescripcion || hasDesc;

            const hasLocation = Boolean(mostrarCoordenadas && img.location && img.location.lat && img.location.lng);

            let footerHtml = '';
            if (showDescBox && hasLocation) {
                const lat = Number(img.location.lat).toFixed(6);
                const lng = Number(img.location.lng).toFixed(6);
                const mapImg = img.location.mapPreview 
                    ? `<img src="${img.location.mapPreview}" class="photo-map-preview" alt="Satélite">` 
                    : '';
                footerHtml = `
                <div class="card-footer">
                    <div class="desc-card">
                        <div class="concept-title">Concepto / Observaciones</div>
                        <div class="concept-text">${escapeHtml(desc || 'Sin descripción')}</div>
                    </div>
                    <div class="location-card">
                        ${mapImg}
                        <div class="location-tag">Ubicación GPS Satélite</div>
                        <div class="location-coords">Lat: ${lat}, Lon: ${lng}</div>
                    </div>
                </div>`;
            } else if (showDescBox) {
                footerHtml = `
                <div class="card-footer">
                    <div class="desc-card full-width">
                        <div class="concept-title">Concepto / Observaciones</div>
                        <div class="concept-text">${escapeHtml(desc || 'Sin descripción')}</div>
                    </div>
                </div>`;
            } else if (hasLocation) {
                const lat = Number(img.location.lat).toFixed(6);
                const lng = Number(img.location.lng).toFixed(6);
                const mapImg = img.location.mapPreview 
                    ? `<img src="${img.location.mapPreview}" class="photo-map-preview" alt="Satélite">` 
                    : '';
                footerHtml = `
                <div class="card-footer">
                    <div class="location-card full-width">
                        ${mapImg}
                        <div>
                            <div class="location-tag">Ubicación GPS Satélite</div>
                            <div class="location-coords">Lat: ${lat}, Lon: ${lng}</div>
                        </div>
                    </div>
                </div>`;
            }

            html += `
            <div class="photo-card">
                <div class="photo-header">
                    ${mostrarNumeroFoto ? `<span class="photo-number">Fotografía #${String(globalIndex).padStart(2, '0')}</span>` : '<span></span>'}
                    ${timeStr ? `<span class="photo-timestamp">${timeStr}</span>` : ''}
                </div>
                <div class="photo-img-wrap">
                    <img src="${img.src}" alt="Foto ${globalIndex}">
                </div>
                ${footerHtml}
            </div>`;
        });

        html += `</div>`; // fin page-body
        html += `</div>`; // fin page-container

        if (!isLast) {
            html += `<div class="page-break"></div>`;
        }
    }

    html += `</body></html>`;
    return html;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = {
    generateReportHtml
};
