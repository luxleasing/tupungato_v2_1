/* ============================================================================
   LUX VISION · Núcleo del visor — TUPUNGATO
   ----------------------------------------------------------------------------
   Visor optimizado para LUMINARIAS únicamente.
   ============================================================================ */

const APP_CONFIG = window.LUX_CONFIG;
if (!APP_CONFIG) throw new Error('[LUX] Falta config.js o window.LUX_CONFIG no está definido.');

const FUENTES_DATA = APP_CONFIG.fuentes;
const CONFIG_CAPAS = APP_CONFIG.capas;
const PALETA       = APP_CONFIG.simbologia;
const CONFIG_UI    = APP_CONFIG.ui;

const geojsonVacio = { type: 'FeatureCollection', features: [] };

/** Mapas base disponibles en el selector del encabezado. */
const ESTILOS_MAPA = {
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    light: {
        version: 8,
        sources: { 'osm-tiles': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
        layers: [{ id: 'osm-layer', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19 }]
    },
    satellite: {
        version: 8,
        sources: { 'satellite-tiles': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Tiles © Esri' } },
        layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', minzoom: 0, maxzoom: 24 }]
    }
};

/** IDs de las capas con ficha técnica. */
const capasInteractivas = () => Object.values(CONFIG_CAPAS).map(c => c.id);


/* ══════════════════════════════════════════════════════════════════════
   02 · ESTADO GLOBAL
   ══════════════════════════════════════════════════════════════════════ */

let estiloActual = localStorage.getItem('map-style') || 'light';
let filtroCategoriaLuminarias = null;

let capasData = {
    luminarias: geojsonVacio
};

let distritosData = geojsonVacio;

const visibilidadCapas = {
    luminarias: true
};

window.datosActualesParaKPI = capasData;

let filtroActivo = { tipo: 'todos', nombre: null, geometria: null };


/* ══════════════════════════════════════════════════════════════════════
   03 · HELPERS
   ══════════════════════════════════════════════════════════════════════ */

function getCampo(props, camposAlt, def = null) {
    if (!props || !Array.isArray(camposAlt)) return def;
    for (const c of camposAlt) {
        if (props[c] !== undefined && props[c] !== null && props[c] !== '') return props[c];
    }
    return def;
}

function getCampoUpper(props, campos, def = '') {
    return String(getCampo(props, campos, def)).trim().toUpperCase();
}

function getCampoNumero(props, campos, def = 0) {
    const val = getCampo(props, campos, null);
    if (val === null) return def;
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
}

function getConfigPorCapaId(layerId) {
    for (const key of Object.keys(CONFIG_CAPAS)) {
        if (CONFIG_CAPAS[key].id === layerId) return { key, config: CONFIG_CAPAS[key] };
    }
    return null;
}

function datosActuales() {
    return window.datosActualesParaKPI || capasData;
}

function setTexto(id, valor) {
    const el = document.getElementById(id);
    if (el) el.innerText = valor;
}

function animarContador(id, valorFinal, opciones = {}) {
    const el = document.getElementById(id);
    if (!el) return;

    const { duracion = 900, decimales = 0, sufijo = '', prefijo = '', formato = null } = opciones;
    const num = parseFloat(valorFinal);
    if (isNaN(num)) { el.innerText = valorFinal; return; }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.innerText = formatear(num);
        return;
    }

    const inicio = performance.now();

    function formatear(n) {
        if (formato) return formato(n);
        return prefijo + n.toLocaleString('es-AR', {
            minimumFractionDigits: decimales,
            maximumFractionDigits: decimales
        }) + sufijo;
    }

    if (el._animacionRAF) cancelAnimationFrame(el._animacionRAF);

    function frame(ahora) {
        const transcurrido = ahora - inicio;
        const progreso = Math.min(transcurrido / duracion, 1);
        const suavizado = 1 - Math.pow(1 - progreso, 3);
        const valorActual = num * suavizado;

        el.innerText = formatear(valorActual);

        if (progreso < 1) {
            el._animacionRAF = requestAnimationFrame(frame);
        } else {
            el.innerText = formatear(num);
            el._animacionRAF = null;
        }
    }

    el._animacionRAF = requestAnimationFrame(frame);
}

function aplicarDatosFiltrados(filtradas) {
    Object.keys(capasData).forEach(key => {
        const sourceId = `${key}-source`;
        if (map.getSource(sourceId)) map.getSource(sourceId).setData(filtradas[key]);
    });
    window.datosActualesParaKPI = filtradas;
    filtroCategoriaLuminarias = null;
    calcularKPIs();
    refrescarStatsSiAbierto();
}

function restaurarDatosCompletos() {
    filtroActivo = { tipo: 'todos', nombre: null, geometria: null };
    aplicarDatosFiltrados(capasData);
}

/* ── Helpers de estadísticas ───────────────────────────────────────── */

function parsearFechaFlexible(valor) {
    if (!valor || valor === 'null' || valor === 'None') return null;
    const s = String(valor).trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) {
        const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
        return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return (isNaN(d.getTime()) || d.getFullYear() < 2000) ? null : d;
}

function contarPorCampo(features, campos, labelVacio = 'Sin dato') {
    const acc = {};
    features.forEach(f => {
        let v = getCampo(f.properties || {}, campos, null);
        if (v === null || v === '') v = labelVacio;
        else v = String(v).trim();
        acc[v] = (acc[v] || 0) + 1;
    });
    return acc;
}

function toRanking(obj) {
    return Object.entries(obj)
        .map(([label, valor]) => ({ label, valor }))
        .sort((a, b) => b.valor - a.valor);
}


/* ══════════════════════════════════════════════════════════════════════
   04 · MAPA
   ══════════════════════════════════════════════════════════════════════ */

const map = new maplibregl.Map({
    container: 'map',
    style: ESTILOS_MAPA[estiloActual],
    center: APP_CONFIG.municipio.mapaInicial.center,
    zoom: APP_CONFIG.municipio.mapaInicial.zoom,
    preserveDrawingBuffer: true
});

const styleSelect = document.getElementById('map-style-select');
const themeToggleBtn = document.getElementById('theme-toggle');
let modoVisual = localStorage.getItem('theme-mode') || 'light';

function cambiarEstiloMapa(nuevoEstilo) {
    if (!ESTILOS_MAPA[nuevoEstilo]) return;
    estiloActual = nuevoEstilo;
    localStorage.setItem('map-style', nuevoEstilo);
    if (styleSelect.value !== nuevoEstilo) styleSelect.value = nuevoEstilo;
    map.setStyle(ESTILOS_MAPA[estiloActual]);
    map.once('idle', () => inyectarFuentesYCapas());
}

function aplicarModoVisual(modo) {
    modoVisual = modo;
    const esOscuro = modo === 'dark';
    document.documentElement.classList.toggle('dark', esOscuro);
    document.documentElement.dataset.theme = esOscuro ? 'dark' : 'light';
    if (themeToggleBtn) {
        themeToggleBtn.setAttribute('aria-pressed', String(esOscuro));
        themeToggleBtn.title = esOscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    }
    localStorage.setItem('theme-mode', modo);
}
aplicarModoVisual(modoVisual);

styleSelect.addEventListener('change', (e) => {
    const estilo = e.target.value;
    if (estilo === 'dark' || estilo === 'light') aplicarModoVisual(estilo);
    cambiarEstiloMapa(estilo);
});

themeToggleBtn.addEventListener('click', () => {
    const nuevoModo = modoVisual === 'dark' ? 'light' : 'dark';
    aplicarModoVisual(nuevoModo);
    if (nuevoModo === 'dark') cambiarEstiloMapa('dark');
    if (nuevoModo === 'light' && estiloActual === 'dark') cambiarEstiloMapa('light');
});


/* ══════════════════════════════════════════════════════════════════════
   05 · WIDGET DE COORDENADAS EN VIVO
   ══════════════════════════════════════════════════════════════════════ */

function inicializarWidgetCoordenadas() {
    const el = document.getElementById('coords-value');
    if (!el) return;
    const dec = CONFIG_UI.coordenadas.decimales;
    const formatear = (lngLat) => `Lat ${lngLat.lat.toFixed(dec)} · Lon ${lngLat.lng.toFixed(dec)}`;

    map.on('mousemove', (e) => { el.textContent = formatear(e.lngLat); });
    map.on('mouseout',  () => { el.textContent = '— · —'; });
    map.on('click', (e) => { el.textContent = formatear(e.lngLat); });
}


/* ══════════════════════════════════════════════════════════════════════
   06 · BUSCADOR OSM + GEOCODIFICACIÓN INVERSA
   ══════════════════════════════════════════════════════════════════════ */

function inicializarBuscadorOSM() {
    const input   = document.getElementById('osm-search-input');
    const resultados = document.getElementById('osm-search-results');
    if (!input || !resultados) return;

    let temporizador = null;
    let marcadorBusqueda = null;

    const construirUrl = (q) => {
        const p = new URLSearchParams({ ...CONFIG_UI.busqueda.params, q });
        if (CONFIG_UI.busqueda.viewbox) p.set('viewbox', CONFIG_UI.busqueda.viewbox);
        if (CONFIG_UI.busqueda.bounded) p.set('bounded', CONFIG_UI.busqueda.bounded);
        return `${CONFIG_UI.busqueda.url}?${p.toString()}`;
    };

    const limpiarResultados = () => { resultados.innerHTML = ''; resultados.classList.add('hidden'); };

    const irALugar = (item) => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        map.flyTo({ center: [lon, lat], zoom: CONFIG_UI.busqueda.zoomResultado });

        if (marcadorBusqueda) marcadorBusqueda.remove();
        marcadorBusqueda = new maplibregl.Marker({ color: PALETA.seleccion.ANILLO })
            .setLngLat([lon, lat])
            .setPopup(new maplibregl.Popup().setText(item.display_name))
            .addTo(map);

        input.value = item.display_name;
        limpiarResultados();
    };

    const renderResultados = (items) => {
        resultados.innerHTML = '';
        if (!items.length) { limpiarResultados(); return; }
        items.forEach(item => {
            const li = document.createElement('button');
            li.type = 'button';
            li.className = 'osm-result-item';
            li.textContent = item.display_name;
            li.addEventListener('click', () => irALugar(item));
            resultados.appendChild(li);
        });
        resultados.classList.remove('hidden');
    };

    input.addEventListener('input', () => {
        clearTimeout(temporizador);
        const q = input.value.trim();
        if (q.length < 3) { limpiarResultados(); return; }

        temporizador = setTimeout(async () => {
            try {
                const res = await fetch(construirUrl(q));
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                renderResultados(await res.json());
            } catch (err) {
                console.error('[LUX] Error en búsqueda Nominatim', err);
                limpiarResultados();
            }
        }, CONFIG_UI.busqueda.debounceMs);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#osm-search-box')) limpiarResultados();
    });
}

let consultaInversaEnCurso = false;

function mostrarClicEnFicha(lngLat) {
    const el = document.getElementById('coords-click-value');
    if (el) {
        const dec = CONFIG_UI.coordenadas.decimales;
        el.textContent = `Lat ${lngLat.lat.toFixed(dec)} · Lon ${lngLat.lng.toFixed(dec)}`;
    }
    consultaInversaNominatim(lngLat);
}

function consultaInversaNominatim(lngLat) {
    if (!CONFIG_UI.busqueda.reverseGeocode || consultaInversaEnCurso) return;
    const cont = document.getElementById('info-ubicacion');
    if (!cont) return;

    consultaInversaEnCurso = true;
    const p = new URLSearchParams({
        format: 'jsonv2', lat: lngLat.lat, lon: lngLat.lng,
        'accept-language': 'es', zoom: 18
    });

    fetch(`${CONFIG_UI.busqueda.reverseUrl}?${p.toString()}`)
        .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .then(json => {
            const direccion = json?.display_name;
            if (direccion) { cont.textContent = direccion; cont.classList.remove('hidden'); }
            else cont.classList.add('hidden');
        })
        .catch(err => { console.warn('[LUX] Reverse geocoding no disponible', err); cont.classList.add('hidden'); })
        .finally(() => { consultaInversaEnCurso = false; });
}


/* ══════════════════════════════════════════════════════════════════════
   07 · CARGA DE DATOS GEOJSON
   ══════════════════════════════════════════════════════════════════════ */

function normalizarGeoJSON(data, key) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        console.error(`[LUX] GeoJSON inválido en la fuente "${key}"`, data);
        return geojsonVacio;
    }
    return data;
}

function cargarTodosLosGeoJSON() {
    const peticiones = Object.keys(FUENTES_DATA).map(key =>
        fetch(FUENTES_DATA[key], { cache: 'no-store' })
            .then(res => { if (!res.ok) throw new Error(`${res.status}`); return res.json(); })
            .then(json => ({ key, data: normalizarGeoJSON(json, key) }))
            .catch(error => {
                console.error(`[LUX] No se pudo cargar la fuente "${key}"`, error);
                return { key, data: geojsonVacio };
            })
    );

    Promise.all(peticiones).then(resultados => {
        resultados.forEach(res => {
            if (res.key === 'distritos') distritosData = res.data;
            else capasData[res.key] = res.data;
        });

        window.datosActualesParaKPI = capasData;
        inyectarFuentesYCapas();
        registrarInteraccionMapa();
        configurarBotonesPrenderApagar();
        calcularKPIs();
        inicializarFiltroDistritos();
        actualizarFechaDesdeCapas();
        renderizarLeyenda();
        sincronizarColoresDesplegables();
    });
}


/* ══════════════════════════════════════════════════════════════════════
   08 · CONSTRUCCIÓN DE CAPAS
   ══════════════════════════════════════════════════════════════════════ */

function colorPorTecnologiaLuminaria() {
    const campos = CONFIG_CAPAS.luminarias.simbologiaCampo;
    const valor = ['upcase', ['to-string', ['coalesce', ...campos.map(c => ['get', c]), '']]];
    return ['case',
        ['in', 'LED', valor], PALETA.luminarias.LED,
        ['in', 'SAP', valor], PALETA.luminarias.SAP,
        PALETA.luminarias.OTROS];
}

function inyectarFuentesYCapas() {
    const vis = key => visibilidadCapas[key] ? 'visible' : 'none';
    const datos = datosActuales();

    // Luminarias
    if (!map.getSource('luminarias-source')) {
        map.addSource('luminarias-source', { type: 'geojson', data: datos.luminarias });
        map.addLayer({
            id: 'luminarias-layer', type: 'circle', source: 'luminarias-source',
            paint: {
                'circle-color': colorPorTecnologiaLuminaria(),
                'circle-radius': 4, 'circle-stroke-width': 0.8, 'circle-stroke-color': '#0f172a'
            },
            layout: { visibility: vis('luminarias') }
        });
    }

    // Capas de dibujo / zona filtrada
    if (!map.getSource('source-poligono-dibujo')) {
        map.addSource('source-poligono-dibujo', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (!map.getLayer('capa-poligono-halo')) {
        map.addLayer({
            id: 'capa-poligono-halo', type: 'line', source: 'source-poligono-dibujo',
            filter: ['in', ['geometry-type'], 'Polygon', 'LineString'],
            paint: {
                'line-color': PALETA.seleccion.ZONA_HALO,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 12, 9, 16, 12],
                'line-opacity': 0.18, 'line-blur': 3
            }
        });
    }

    if (!map.getLayer('capa-poligono-fill')) {
        map.addLayer({
            id: 'capa-poligono-fill', type: 'fill', source: 'source-poligono-dibujo',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'fill-color': PALETA.seleccion.ZONA_RELLENO, 'fill-opacity': 0.3 }
        });
    }

    if (!map.getLayer('capa-poligono-line')) {
        map.addLayer({
            id: 'capa-poligono-line', type: 'line', source: 'source-poligono-dibujo',
            filter: ['in', ['geometry-type'], 'Polygon', 'LineString'],
            paint: {
                'line-color': PALETA.seleccion.ZONA_BORDE,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.8, 12, 2.2, 16, 2.8],
                'line-opacity': 0.3, 'line-dasharray': [3, 1.5]
            }
        });
    }

    if (!map.getLayer('capa-poligono-vertices')) {
        map.addLayer({
            id: 'capa-poligono-vertices', type: 'circle', source: 'source-poligono-dibujo',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 7],
                'circle-color': PALETA.seleccion.ZONA_VERTICE,
                'circle-stroke-width': 2,
                'circle-stroke-color': PALETA.seleccion.ZONA_BORDE,
                'circle-opacity': 0.95
            }
        });
    }
}


/* ══════════════════════════════════════════════════════════════════════
   09 · LEYENDA DINÁMICA
   ══════════════════════════════════════════════════════════════════════ */

function renderizarLeyenda() {
    const cont = document.getElementById('legend-body');
    if (!cont) return;
    const S = PALETA;

    const filaPunto = (color, texto) =>
        `<div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full border border-slate-500" style="background:${color}"></span>${texto}</div>`;

    cont.innerHTML = `
        <div class="legend-group-title">Luminarias</div>
        ${filaPunto(S.luminarias.LED, 'LED')}
        ${filaPunto(S.luminarias.SAP, 'SAP')}
        ${filaPunto(S.luminarias.OTROS, 'Otros')}
    `;
}

function sincronizarColoresDesplegables() {
    document.querySelectorAll('[data-sym]').forEach(el => {
        const [grupo, categoria] = el.dataset.sym.split(':');
        const color = PALETA[grupo]?.[categoria];
        if (color) {
            el.style.background = color;
            el.classList.remove('bg-cyan-400', 'bg-orange-400', 'bg-slate-400',
                               'bg-slate-700', 'bg-slate-500', 'bg-slate-300',
                               'bg-slate-800', 'bg-slate-600');
        }
    });
}


/* ══════════════════════════════════════════════════════════════════════
   10 · INTERACCIÓN CON EL MAPA
   ══════════════════════════════════════════════════════════════════════ */

let interaccionRegistrada = false;
function registrarInteraccionMapa() {
    if (interaccionRegistrada) return;
    interaccionRegistrada = true;

    map.on('click', (e) => {
        if (dibujoPoligono.activo) {
            dibujoPoligono.coordenadas.push([e.lngLat.lng, e.lngLat.lat]);
            actualizarGeometriaVisualNativa();
            actualizarBarraPoligono();
            return;
        }

        mostrarClicEnFicha(e.lngLat);

        const features = map.queryRenderedFeatures(e.point, { layers: capasInteractivas() });
        if (!features || features.length === 0) { limpiarSeleccion(); return; }
        const feature = features[0];

        mostrarFicha(feature);
    });

    map.on('mousemove', (e) => {
        if (dibujoPoligono.activo) return;
        const features = map.queryRenderedFeatures(e.point, { layers: capasInteractivas() });
        map.getCanvas().style.cursor = (features && features.length) ? 'pointer' : '';
    });
}


/* ══════════════════════════════════════════════════════════════════════
   11 · FICHA LATERAL DINÁMICA
   ══════════════════════════════════════════════════════════════════════ */

function renderCeldasFicha(containerId, items, props, acumulador = null) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    cont.innerHTML = '';
    if (!items || items.length === 0) return;

    items.forEach((item, idx) => {
        const valor = getCampo(props, item.campos, null);
        const valorFmt = valor != null && valor !== '' ? valor : '-';

        const celda = document.createElement('div');
        celda.className = 'ficha-celda';
        if (idx % 2 === 0) celda.classList.add('border-r');
        celda.innerHTML = `
            <span class="ficha-label">${item.etiqueta}</span>
            <span class="ficha-valor">${valorFmt}</span>
        `;
        cont.appendChild(celda);

        if (acumulador) acumulador.push({ etiqueta: item.etiqueta, valor: valorFmt });
    });
}

function mostrarFicha(feature) {
    const props = feature.properties || {};
    const configInfo = getConfigPorCapaId(feature.layer.id);
    if (!configInfo) return;
    const { config } = configInfo;

    setTexto('info-id', getCampo(props, config.idCampo, 'N/A'));
    setTexto('info-elemento', config.elementoFijo || '-');

    const valoresFicha = [];

    renderCeldasFicha('ficha-primaria',   config.fichaPrimaria   || [], props, valoresFicha);
    renderCeldasFicha('ficha-secundaria', config.fichaSecundaria || [], props, valoresFicha);

    window.activoSeleccionadoConfig = { config, valores: valoresFicha };

    const sec = document.getElementById('ficha-secundaria');
    if (sec) sec.classList.add('hidden');
    const chevron = document.getElementById('chevron-ver-mas');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    const label = document.getElementById('label-ver-mas');
    if (label) label.textContent = 'Ver más campos';

    actualizarStreetView(feature);
}

function coordsDelFeature(feature) {
    const geom = feature.geometry;
    if (!geom) return null;
    if (geom.type === 'Point') return geom.coordinates;
    if (geom.type === 'LineString' && geom.coordinates.length) {
        return geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    }
    return null;
}

function actualizarStreetView(feature) {
    const coords = coordsDelFeature(feature);
    if (!coords) return;

    const [lon, lat] = coords;
    const strLat = lat.toString();
    const strLon = lon.toString();

    window.activoSeleccionadoLat = strLat;
    window.activoSeleccionadoLon = strLon;
    destacarPuntoEnMapa(lon, lat);

    const iframe = document.getElementById('street-view-frame');
    const placeholder = document.getElementById('sv-placeholder');

    if (placeholder) placeholder.classList.add('hidden');
    if (iframe) {
        iframe.classList.remove('hidden');
        iframe.src = `https://maps.google.com/maps?q=${strLat},${strLon}&cbll=${strLat},${strLon}&layer=c&panoid=&cbp=12,0,0,0,0&source=embed&output=svembed`;
    }

    const btn = document.getElementById('btn-sv-external');
    if (btn) {
        btn.href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${strLat},${strLon}`;
        btn.classList.remove('pointer-events-none', 'opacity-50');
    }
}

function destacarPuntoEnMapa(lng, lat) {
    const sourceId = 'source-seleccion-activo';
    const punto = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } }]
    };

    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(punto);
        return;
    }

    map.addSource(sourceId, { type: 'geojson', data: punto });
    map.addLayer({
        id: 'layer-seleccion-glow', type: 'circle', source: sourceId,
        paint: { 'circle-radius': 22, 'circle-color': PALETA.seleccion.ANILLO, 'circle-opacity': 0.15 }
    });
    map.addLayer({
        id: 'layer-seleccion-ring', type: 'circle', source: sourceId,
        paint: {
            'circle-radius': 16, 'circle-color': 'transparent',
            'circle-stroke-width': 2, 'circle-stroke-color': PALETA.seleccion.ANILLO,
            'circle-stroke-opacity': 0.6
        }
    });
    map.addLayer({
        id: 'layer-seleccion-activo', type: 'circle', source: sourceId,
        paint: {
            'circle-radius': 8, 'circle-color': PALETA.seleccion.CENTRO,
            'circle-stroke-width': 3, 'circle-stroke-color': PALETA.seleccion.ANILLO
        }
    });
}

function limpiarSeleccion() {
    const sourceId = 'source-seleccion-activo';
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData({ type: 'FeatureCollection', features: [] });
    }
    window.activoSeleccionadoConfig = null;
}


/* ══════════════════════════════════════════════════════════════════════
   12 · BRANDING Y FECHA DE ACTUALIZACIÓN
   ══════════════════════════════════════════════════════════════════════ */

function aplicarConfiguracionMunicipal() {
    const { municipio } = APP_CONFIG;
    document.title = `Lux Leasing — ${municipio.tituloAplicacion}`;

    const h1 = document.querySelector('header h1');
    if (h1) {
        h1.innerHTML = `${municipio.tituloAplicacion} <span class="text-slate-500 mx-1.5">•</span> Municipio de ${municipio.nombre}`;
    }

    const enlaces = document.querySelectorAll('header a');
    const imagenes = document.querySelectorAll('header a img');
    if (enlaces[0]) enlaces[0].href = municipio.branding.logoLux.href;
    if (imagenes[0]) imagenes[0].src = municipio.branding.logoLux.src;
    if (enlaces[1]) enlaces[1].href = municipio.branding.logoMunicipio.href;
    if (imagenes[1]) imagenes[1].src = municipio.branding.logoMunicipio.src;
}

function actualizarFechaDesdeCapas() {
    const camposFecha = APP_CONFIG.camposGlobales.fechaActualizacion;
    let fechaMax = null;

    (capasData.luminarias.features || []).forEach(f => {
        const fecha = parsearFechaFlexible(getCampo(f.properties || {}, camposFecha, null));
        if (fecha && fecha.getFullYear() >= 2020) {
            if (!fechaMax || fecha > fechaMax) fechaMax = fecha;
        }
    });

    const el = document.getElementById('fecha-ultima-actualizacion');
    if (!el) return;
    el.innerText = fechaMax
        ? fechaMax.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : 'Sin dato';
}


/* ══════════════════════════════════════════════════════════════════════
   13 · BOTONES DE CAPAS DEL ENCABEZADO
   ══════════════════════════════════════════════════════════════════════ */

function configurarBotonesPrenderApagar() {
    const definiciones = {
        luminarias:  { btn: 'btn-mod-luminarias', layers: ['luminarias-layer'] }
    };

    const setEstadoVisual = (btn, activo) => {
        if (!btn) return;
        btn.classList.toggle('layer-button-off', !activo);
        btn.classList.toggle('layer-button-on', activo);
        btn.setAttribute('aria-pressed', String(activo));
    };

    const aplicarVisibilidad = (key, activo) => {
        const def = definiciones[key];
        visibilidadCapas[key] = activo;
        def.layers.forEach(layerId => {
            if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', activo ? 'visible' : 'none');
        });
        setEstadoVisual(document.getElementById(def.btn), activo);
    };

    const estanTodosActivos = () => Object.keys(definiciones).every(key => visibilidadCapas[key]);

    Object.entries(definiciones).forEach(([key, def]) => {
        const btn = document.getElementById(def.btn);
        if (!btn || btn.dataset.ready === '1') return;
        btn.dataset.ready = '1';

        setEstadoVisual(btn, visibilidadCapas[key]);
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            aplicarVisibilidad(key, !visibilidadCapas[key]);
            actualizarBotonTodos();
        });
    });

    const btnTodos = document.getElementById('btn-mod-todos');
    const actualizarBotonTodos = () => {
        if (!btnTodos) return;
        btnTodos.classList.toggle('opacity-50', !estanTodosActivos());
        btnTodos.setAttribute('aria-pressed', String(estanTodosActivos()));
    };

    if (btnTodos && btnTodos.dataset.ready !== '1') {
        btnTodos.dataset.ready = '1';
        btnTodos.addEventListener('click', (e) => {
            e.preventDefault();
            const encender = !estanTodosActivos();
            Object.keys(definiciones).forEach(key => aplicarVisibilidad(key, encender));
            actualizarBotonTodos();
        });
    }
    actualizarBotonTodos();
}


/* ══════════════════════════════════════════════════════════════════════
   14 · KPIs
   ══════════════════════════════════════════════════════════════════════ */

function pct(parte, total) {
    return total ? ((parte / total) * 100).toFixed(1) + '%' : '0%';
}

function calcularKPIs() {
    const datos = datosActuales();

    // ── Luminarias ──
    const luminarias = datos.luminarias?.features || [];
    const totalLum = luminarias.length;
    const camposTec = CONFIG_CAPAS.luminarias?.kpis?.tecnologia?.campo || ['TECNOLOGIA'];

    let led = 0, sap = 0, otrosLum = 0;
    luminarias.forEach(f => {
        const tipo = getCampoUpper(f.properties || {}, camposTec, '');
        if (tipo.includes('LED')) led++;
        else if (tipo.includes('SAP')) sap++;
        else otrosLum++;
    });
    animarContador('kpi-total', totalLum);
    setTexto('kpi-led', `${led.toLocaleString()} (${pct(led, totalLum)})`);
    setTexto('kpi-sap', `${sap.toLocaleString()} (${pct(sap, totalLum)})`);
    setTexto('kpi-lum-otros', `${otrosLum.toLocaleString()} (${pct(otrosLum, totalLum)})`);
}


/* ══════════════════════════════════════════════════════════════════════
   15 · FILTROS POR DISTRITO
   ══════════════════════════════════════════════════════════════════════ */

const norm = s => String(s || '').trim().toUpperCase();

function geometriaConsultaDistrito(distritoFeature) {
    const metros = CONFIG_UI.filtroDistrito.bufferMetros || 0;
    if (metros > 0 && typeof turf !== 'undefined') {
        try {
            return turf.buffer(distritoFeature, metros / 1000, { units: 'kilometers' });
        } catch (err) {
            console.warn('[LUX] turf.buffer falló; se usa el polígono sin buffer', err);
        }
    }
    return distritoFeature;
}

function featureIntersectaGeometria(feature, geometriaConsulta) {
    try {
        if (typeof turf === 'undefined') throw new Error('[LUX] Turf.js no cargado');
        const geom = feature.geometry;
        if (!geom) return false;
        if (geom.type === 'Point') return turf.booleanPointInPolygon(feature, geometriaConsulta);
        return turf.booleanIntersects(feature, geometriaConsulta);
    } catch (err) {
        const pt = coordsRepresentativas(feature);
        const polys = (geometriaConsulta.geometry?.type === 'FeatureCollection')
            ? geometriaConsulta.features : [geometriaConsulta];
        return pt ? polys.some(p => puntoEnPoligono(pt, p.geometry)) : false;
    }
}

function puntoEnPoligono(pt, geom) {
    const [x, y] = pt;
    const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
        : geom.type === 'MultiPolygon' ? geom.coordinates.map(r => r[0])
        : [];
    let inside = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
    }
    return inside;
}

function coordsRepresentativas(feature) {
    const g = feature.geometry;
    if (!g) return null;
    if (g.type === 'Point') return g.coordinates;
    if (g.type === 'LineString') return g.coordinates[Math.floor(g.coordinates.length / 2)];
    if (g.type === 'Polygon') return g.coordinates[0][0];
    if (g.type === 'MultiPolygon') return g.coordinates[0][0][0];
    return null;
}

function aplicarFiltroGeometrico(geometriaConsulta, nombreFiltro) {
    const filtradas = {};
    Object.keys(capasData).forEach(key => {
        filtradas[key] = {
            type: 'FeatureCollection',
            features: (capasData[key].features || []).filter(f => featureIntersectaGeometria(f, geometriaConsulta))
        };
    });
    filtroActivo = { tipo: 'distrito', nombre: nombreFiltro, geometria: geometriaConsulta };
    aplicarDatosFiltrados(filtradas);
    pintarGeometriaDeConsulta(geometriaConsulta);
    dibujoPoligono.aplicado = true;
    actualizarBarraPoligono();
    encuadrarZona(geometriaConsulta);
}

function encuadrarZona(zonaFeature) {
    if (!zonaFeature?.geometry) return;

    let bbox;
    try {
        bbox = (typeof turf !== 'undefined' && turf.bbox)
            ? turf.bbox(zonaFeature)
            : bboxManual(zonaFeature.geometry);
    } catch (err) {
        console.warn('[LUX] No se pudo calcular el bbox de la zona', err);
        return;
    }
    if (!bbox || bbox.length !== 4 || bbox.some(v => !isFinite(v))) return;

    const cfg = CONFIG_UI.filtroDistrito?.zoomAlFiltrar || {};
    map.fitBounds(
        [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        { padding: cfg.padding ?? 60, duration: cfg.duracionMs ?? 900, maxZoom: cfg.maxZoom ?? 16 }
    );
}

function bboxManual(geom) {
    const coords = [];
    const recorrer = (arr) => {
        if (typeof arr[0] === 'number') coords.push(arr);
        else arr.forEach(recorrer);
    };
    recorrer(geom.coordinates);
    if (!coords.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    coords.forEach(([x, y]) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    });
    return [minX, minY, maxX, maxY];
}

function pintarGeometriaDeConsulta(geometria) {
    const source = map.getSource('source-poligono-dibujo');
    if (!source || !geometria) return;

    const feat = (geometria.type === 'Feature')
        ? geometria
        : { type: 'Feature', geometry: geometria, properties: {} };

    source.setData({ type: 'FeatureCollection', features: [feat] });
}

function aplicarFiltroDistrito(nombreDistrito) {
    if (!nombreDistrito || norm(nombreDistrito) === norm('Todos')) {
        restaurarDatosCompletos();
        return;
    }
    const campoNombre = APP_CONFIG.camposGlobales.distritoNombre;
    const distritoFeat = (distritosData.features || []).find(f =>
        norm(getCampo(f.properties || {}, campoNombre, '')) === norm(nombreDistrito)
    );
    if (!distritoFeat) {
        console.warn(`[LUX] Distrito no encontrado en los datos: "${nombreDistrito}"`);
        return;
    }
    aplicarFiltroGeometrico(geometriaConsultaDistrito(distritoFeat), nombreDistrito);
}

function inicializarFiltroDistritos() {
    const select = document.getElementById('filtro-distrito');
    if (!select) return;

    const campoNombre = APP_CONFIG.camposGlobales.distritoNombre;
    const nombres = [...new Set(
        (distritosData.features || [])
            .map(f => getCampo(f.properties || {}, campoNombre, ''))
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    nombres.forEach(nombre => {
        const op = document.createElement('option');
        op.value = nombre;
        op.innerText = nombre;
        select.appendChild(op);
    });

    select.addEventListener('change', (e) => aplicarFiltroDistrito(e.target.value));
}


/* ══════════════════════════════════════════════════════════════════════
   16 · SELECCIÓN ESPACIAL POR POLÍGONO DIBUJADO
   ══════════════════════════════════════════════════════════════════════ */

const dibujoPoligono = {
    activo: false,
    aplicado: false,
    coordenadas: []
};

function alternarDibujoPoligono() {
    if (dibujoPoligono.activo) finalizarDibujoPoligono();
    else iniciarDibujoPoligono();
}

function iniciarDibujoPoligono() {
    dibujoPoligono.activo = true;
    dibujoPoligono.aplicado = false;
    dibujoPoligono.coordenadas = [];
    map.getCanvas().style.cursor = 'crosshair';

    const btn = document.getElementById('btn-bbox-select');
    if (btn) {
        btn.classList.add('tool-active');
        btn.title = 'Dibujando… clic para marcar vértices.';
    }

    actualizarGeometriaVisualNativa();
    actualizarBarraPoligono();
}

function finalizarDibujoPoligono() {
    dibujoPoligono.activo = false;
    map.getCanvas().style.cursor = '';
    const btn = document.getElementById('btn-bbox-select');
    if (btn) {
        btn.classList.remove('tool-active');
        btn.title = 'Dibujar zona de selección (clic para marcar vértices)';
    }
}

function actualizarGeometriaVisualNativa() {
    const source = map.getSource('source-poligono-dibujo');
    if (!source) return;

    const coords = dibujoPoligono.coordenadas;
    const features = [];

    if (coords.length >= 3) {
        features.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
            properties: {}
        });
    } else if (coords.length === 2) {
        features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: {}
        });
    }

    coords.forEach(c => {
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: c },
            properties: {}
        });
    });

    source.setData({ type: 'FeatureCollection', features });
}

function actualizarBarraPoligono() {
    const barra = document.getElementById('bbox-toolbar');
    if (!barra) return;
    const visible = dibujoPoligono.activo || dibujoPoligono.aplicado;
    barra.classList.toggle('hidden', !visible);
}

function aplicarFiltroPoligono() {
    const coords = dibujoPoligono.coordenadas;

    if (coords.length < 3) {
        alert('Debes marcar al menos 3 puntos para formar un polígono.');
        return;
    }
    if (typeof turf === 'undefined') {
        console.error('[LUX] Turf.js no está cargado.');
        return;
    }

    const anillo = [...coords, coords[0]];
    const poligonoFeature = turf.polygon([anillo]);
    const geometriaPoligono = poligonoFeature.geometry;

    const filtradas = {};
    Object.keys(capasData).forEach(key => {
        const originales = capasData[key]?.features || [];
        const dentro = originales.filter(f => featureIntersectaGeometria(f, geometriaPoligono));
        filtradas[key] = { type: 'FeatureCollection', features: dentro };
    });

    filtroActivo = { tipo: 'poligono', nombre: 'Selección por polígono', geometria: poligonoFeature };
    aplicarDatosFiltrados(filtradas);

    dibujoPoligono.aplicado = true;
    dibujoPoligono.activo = false;
    map.getCanvas().style.cursor = '';
    const btn = document.getElementById('btn-bbox-select');
    if (btn) {
        btn.classList.remove('tool-active');
        btn.title = 'Dibujar zona de selección (clic para marcar vértices)';
    }
    actualizarBarraPoligono();
}

function restaurarFiltroPoligono() {
    dibujoPoligono.aplicado = false;
    dibujoPoligono.activo = false;
    dibujoPoligono.coordenadas = [];
    actualizarGeometriaVisualNativa();

    const source = map.getSource('source-poligono-dibujo');
    if (source) source.setData({ type: 'FeatureCollection', features: [] });

    restaurarDatosCompletos();

    const select = document.getElementById('filtro-distrito');
    if (select) select.value = 'Todos';

    actualizarBarraPoligono();
}

function inicializarHerramientaBbox() {
    const btnDibujar = document.getElementById('btn-bbox-select');
    if (btnDibujar && btnDibujar.dataset.ready !== '1') {
        btnDibujar.dataset.ready = '1';
        btnDibujar.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            alternarDibujoPoligono();
        });
    }

    const btnAplicar = document.getElementById('btn-bbox-apply');
    if (btnAplicar && btnAplicar.dataset.ready !== '1') {
        btnAplicar.dataset.ready = '1';
        btnAplicar.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            aplicarFiltroPoligono();
        });
    }

    const btnRestaurar = document.getElementById('btn-bbox-reset');
    if (btnRestaurar && btnRestaurar.dataset.ready !== '1') {
        btnRestaurar.dataset.ready = '1';
        btnRestaurar.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            restaurarFiltroPoligono();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dibujoPoligono.activo) finalizarDibujoPoligono();
    });
}


/* ══════════════════════════════════════════════════════════════════════
   17 · PANEL DE ESTADÍSTICAS EJECUTIVO
   ══════════════════════════════════════════════════════════════════════ */

let seccionStatsAbierta = sessionStorage.getItem('stats-open') || 'luminarias';

function refrescarStatsSiAbierto() {
    const panel = document.getElementById('stats-panel');
    if (panel && !panel.classList.contains('translate-x-full')) {
        renderizarEstadisticas();
    }
}

/* ── Helpers de presentación ───────────────────────────────────────── */

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}

function kpi(label, valor, sub, tooltip, acento) {
    const info = tooltip
        ? `<span title="${esc(tooltip)}" style="color:var(--stats-sub);cursor:help;margin-left:4px;font-size:11px;">?</span>`
        : '';
    return `
        <div class="rounded-md px-3 py-2.5"
             style="background:var(--stats-celda-bg);border:1px solid var(--stats-celda-border);">
            <div class="flex items-center text-[11px] font-medium mb-1" style="color:var(--stats-label);">
                <span>${esc(label)}</span>${info}
            </div>
            <div class="text-[16px] font-semibold tabular-nums leading-tight"
                 style="color:${acento || 'var(--stats-valor)'};">${valor}</div>
            ${sub ? `<div class="text-[11px] mt-0.5" style="color:var(--stats-sub);">${sub}</div>` : ''}
        </div>`;
}

function nota(texto, nivel) {
    const colores = { danger: '#dc2626', warn: '#d97706', ok: '#16a34a' };
    return `
        <div class="pl-2.5 border-l-2 text-[12px] leading-snug"
             style="border-color:${colores[nivel] || '#a1a1aa'};color:var(--stats-label);">
            ${texto}
        </div>`;
}

function barraApilada(items, alto = 6) {
    const total = items.reduce((a, b) => a + b.valor, 0) || 1;
    const segs = items.map(it => {
        const w = (it.valor / total) * 100;
        return w > 0 ? `<div style="width:${w}%;background:${it.color};" title="${esc(it.label)}: ${it.valor.toLocaleString('es-AR')}"></div>` : '';
    }).join('');
    const leyenda = items.map(it => `
        <div class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full" style="background:${it.color};"></span>
            <span class="text-[11px]" style="color:var(--stats-label);">${esc(it.label)}</span>
            <span class="text-[11px] font-medium tabular-nums" style="color:var(--stats-valor);">${it.valor.toLocaleString('es-AR')}</span>
        </div>`).join('');
    return `
        <div class="flex overflow-hidden rounded-sm" style="height:${alto}px;background:var(--stats-celda-border);">
            ${segs}
        </div>
        <div class="flex flex-wrap gap-x-3.5 gap-y-1 mt-2">${leyenda}</div>`;
}

function ranking(items, color = '#52525b', max = 8) {
    if (!items.length) {
        return `<div class="text-[11px] py-1.5" style="color:var(--stats-sub);">Sin datos.</div>`;
    }
    const top = items.slice(0, max);
    const maxVal = Math.max(...top.map(i => i.valor), 1);
    return top.map((it, i) => `
        <div class="flex items-center gap-2 py-[3px]">
            <span class="text-[11px] tabular-nums w-4 text-right flex-shrink-0" style="color:var(--stats-sub);">${i + 1}</span>
            <span class="text-[12px] truncate flex-1" style="color:var(--stats-valor);" title="${esc(it.label)}">${esc(it.label)}</span>
            <span class="text-[11px] font-medium tabular-nums flex-shrink-0" style="color:var(--stats-label);">${it.valor.toLocaleString('es-AR')}</span>
            <div class="w-12 rounded-sm h-[3px] overflow-hidden flex-shrink-0" style="background:var(--stats-celda-border);">
                <div style="width:${(it.valor / maxVal) * 100}%;background:${color};height:3px;"></div>
            </div>
        </div>`).join('');
}

function fila(label, valor, tooltip) {
    const info = tooltip
        ? `<span title="${esc(tooltip)}" style="color:var(--stats-sub);cursor:help;margin-left:4px;font-size:11px;">?</span>`
        : '';
    return `
        <div class="flex justify-between items-baseline py-[5px]" style="border-bottom:1px solid var(--stats-celda-border);">
            <span class="text-[12px]" style="color:var(--stats-label);">${esc(label)}${info}</span>
            <span class="text-[12px] font-medium tabular-nums" style="color:var(--stats-valor);">${valor}</span>
        </div>`;
}

function sub(texto) {
    return `<div class="text-[11px] font-medium mb-1.5 mt-3 first:mt-0" style="color:var(--stats-sub);">${esc(texto)}</div>`;
}

function fmtNum(v, dec = 0) {
    return v.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/* ── LUMINARIAS (limpio: sin potencia ni vida útil) ───────────────── */

function renderStatsLuminarias() {
    const datos = datosActuales().luminarias?.features || [];
    const alertCfg = APP_CONFIG.estadisticas?.alertas || {};

    const campoSoporte  = ['SOPORTE', 'soporte'];
    const campoFuncion  = ['FUNCION', 'funcion'];
    const campoZona     = ['ZONA', 'zona'];
    const campoElemento = ['ELEMENTO', 'elemento'];

    const acento = PALETA.luminarias.LED;

    let led = 0, sap = 0, otros = 0;
    const porZona = {};

    datos.forEach(f => {
        const p = f.properties || {};
        const t = clasificarTecnologiaLuminaria(f);

        if (t === 'LED') led++;
        else if (t === 'SAP') sap++;
        else otros++;

        const zona = getCampoUpper(p, campoZona, '') || 'SIN DATO';
        if (!porZona[zona]) porZona[zona] = { total: 0, led: 0 };
        porZona[zona].total++;
        if (t === 'LED') porZona[zona].led++;
    });

    const total  = datos.length;
    const pctLed = total ? (led / total) * 100 : 0;
    const pctSap = total ? (sap / total) * 100 : 0;

    const porSoporte  = contarPorCampo(datos, campoSoporte, 'Sin dato');
    const porFuncion  = contarPorCampo(datos, campoFuncion, 'Sin dato');
    const porElemento = contarPorCampo(datos, campoElemento, 'Sin dato');

    return `
        <div class="p-4 space-y-3">
            <div class="grid grid-cols-2 gap-2">
                ${kpi('% LED', fmtNum(pctLed, 1) + '%',
                     `${fmtNum(led)} de ${fmtNum(total)}`, null, acento)}
                ${kpi('% SAP', fmtNum(pctSap, 1) + '%',
                     `${fmtNum(sap)} luminarias`)}
            </div>

            ${sub('Composición del parque')}
            ${barraApilada([
                { label: 'LED',   valor: led,   color: PALETA.luminarias.LED },
                { label: 'SAP',   valor: sap,   color: PALETA.luminarias.SAP },
                { label: 'Otros', valor: otros, color: PALETA.luminarias.OTROS }
            ])}
            ${pctSap > (alertCfg.porcentajeSapCritico || 30)
                ? nota(`${fmtNum(pctSap, 1)}% del parque continúa en SAP.`, 'warn')
                : nota(`${fmtNum(pctLed, 1)}% del parque ya reconvertido a LED.`, 'ok')}

            ${sub('Parque por zona')}
            <div class="rounded-md px-3 py-2" style="background:var(--stats-celda-bg);border:1px solid var(--stats-celda-border);">
                ${toRanking(Object.fromEntries(Object.entries(porZona).map(([k,v]) => [k, v.total])))
                    .map(z => {
                        const zz = porZona[z.label];
                        const pL = zz.total ? (zz.led / zz.total) * 100 : 0;
                        return fila(z.label, `${fmtNum(zz.total)} lum · ${fmtNum(pL, 0)}% LED`);
                    }).join('')}
            </div>

            ${sub('Soporte predominante')}
            <div>${ranking(toRanking(porSoporte), '#52525b', 6)}</div>

            ${sub('Cantidad por función')}
            <div>${ranking(toRanking(porFuncion), '#52525b', 6)}</div>

            ${sub('Cantidad por elemento')}
            <div>${ranking(toRanking(porElemento), '#52525b', 6)}</div>
        </div>
    `;
}

/* ── Acordeón maestro ──────────────────────────────────────────────── */

function seccionHTML(id, titulo, resumen, contenido) {
    const abierto = seccionStatsAbierta === id;
    return `
        <div style="border-bottom:1px solid var(--stats-border);">
            <button class="stats-section-header w-full flex items-center justify-between px-4 py-2.5 transition-colors cursor-pointer"
                    data-section="${id}" aria-expanded="${abierto}"
                    style="background:transparent;"
                    onmouseover="this.style.background='var(--stats-hover)'"
                    onmouseout="this.style.background='transparent'">
                <div class="flex items-center gap-2">
                    <span class="stats-chevron text-[10px] transition-transform duration-200"
                          style="color:var(--stats-sub);transform:rotate(${abierto ? 90 : 0}deg);">▶</span>
                    <span class="text-[12px] font-medium" style="color:var(--stats-valor);">${titulo}</span>
                </div>
                <span class="text-[11px] tabular-nums" style="color:var(--stats-sub);">${resumen}</span>
            </button>
            <div class="stats-section-body ${abierto ? '' : 'hidden'}" data-body="${id}">${contenido}</div>
        </div>
    `;
}

function renderizarEstadisticas() {
    const cont = document.getElementById('stats-content');
    if (!cont) return;

    const datos = datosActuales();
    const lumCount = datos.luminarias?.features?.length || 0;

    cont.innerHTML = `
        ${seccionHTML('luminarias', 'Luminarias', fmtNum(lumCount), renderStatsLuminarias())}
    `;

    cont.querySelectorAll('.stats-section-header').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.section;
            const yaAbierto = seccionStatsAbierta === id;

            cont.querySelectorAll('.stats-section-body').forEach(b => b.classList.add('hidden'));
            cont.querySelectorAll('.stats-chevron').forEach(c => c.style.transform = 'rotate(0deg)');
            cont.querySelectorAll('.stats-section-header').forEach(h => h.setAttribute('aria-expanded', 'false'));

            if (!yaAbierto) {
                cont.querySelector(`[data-body="${id}"]`)?.classList.remove('hidden');
                btn.querySelector('.stats-chevron').style.transform = 'rotate(90deg)';
                btn.setAttribute('aria-expanded', 'true');
                seccionStatsAbierta = id;
            } else {
                seccionStatsAbierta = null;
            }
            sessionStorage.setItem('stats-open', seccionStatsAbierta || '');
        });
    });
}

function inicializarPanelEstadisticas() {
    const btn = document.getElementById('btn-stats');
    const btnClose = document.getElementById('btn-close-stats');
    const panel = document.getElementById('stats-panel');
    if (!btn || !btnClose || !panel) return;

    btn.addEventListener('click', () => {
        renderizarEstadisticas();
        panel.classList.remove('translate-x-full');
    });
    btnClose.addEventListener('click', () => {
        panel.classList.add('translate-x-full');
    });
}


/* ══════════════════════════════════════════════════════════════════════
   18 · UTILIDADES DE UI
   ══════════════════════════════════════════════════════════════════════ */

function inicializarLeyenda() {
    const btn = document.getElementById('legend-toggle');
    const panel = document.getElementById('legend-panel');
    const chevron = document.getElementById('legend-chevron');
    if (!btn || !panel || btn.dataset.ready === '1') return;
    btn.dataset.ready = '1';
    panel.classList.add('hidden');

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const abrir = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !abrir);
        if (chevron) chevron.textContent = abrir ? '▴' : '▾';
    });
}

function inicializarAcordeonFicha() {
    const btn = document.getElementById('btn-ver-mas-campos');
    const panelSec = document.getElementById('ficha-secundaria');
    const chevron = document.getElementById('chevron-ver-mas');
    const label = document.getElementById('label-ver-mas');
    if (!btn || btn.dataset.ready === '1') return;
    btn.dataset.ready = '1';

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!panelSec) return;
        const abrir = panelSec.classList.contains('hidden');
        panelSec.classList.toggle('hidden', !abrir);
        if (chevron) chevron.style.transform = abrir ? 'rotate(180deg)' : 'rotate(0deg)';
        if (label) label.textContent = abrir ? 'Ver menos campos' : 'Ver más campos';
    });
}

function inicializarFiltroCategoriasLuminarias() {
    document.querySelectorAll('[data-lum-category]').forEach(el => {
        if (el.dataset.ready === '1') return;
        el.dataset.ready = '1';
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            aplicarFiltroCategoriaLuminarias(el.dataset.lumCategory);
        });
    });
}

function clasificarTecnologiaLuminaria(feature) {
    const cfg = CONFIG_CAPAS.luminarias.kpis.tecnologia;
    const valor = getCampoUpper(feature?.properties || {}, cfg.campo, '');
    if (valor.includes('LED')) return 'LED';
    if (valor.includes('SAP')) return 'SAP';
    return 'OTROS';
}

function aplicarFiltroCategoriaLuminarias(categoria) {
    filtroCategoriaLuminarias = (filtroCategoriaLuminarias === categoria) ? null : categoria;

    const base = datosActuales().luminarias || capasData.luminarias;
    const features = filtroCategoriaLuminarias
        ? (base.features || []).filter(f => clasificarTecnologiaLuminaria(f) === filtroCategoriaLuminarias)
        : (base.features || []);

    const source = map.getSource(CONFIG_CAPAS.luminarias.source);
    if (source) source.setData({ type: 'FeatureCollection', features });

    document.querySelectorAll('[data-lum-category]').forEach(el => {
        el.classList.toggle('is-active', el.dataset.lumCategory === filtroCategoriaLuminarias);
    });

    const counts = { LED: 0, SAP: 0, OTROS: 0 };
    features.forEach(f => counts[clasificarTecnologiaLuminaria(f)]++);
    setTexto('kpi-total', features.length.toLocaleString());
    setTexto('kpi-led', `${counts.LED.toLocaleString()} (${pct(counts.LED, features.length)})`);
    setTexto('kpi-sap', `${counts.SAP.toLocaleString()} (${pct(counts.SAP, features.length)})`);
    setTexto('kpi-lum-otros', `${counts.OTROS.toLocaleString()} (${pct(counts.OTROS, features.length)})`);
}


/* ══════════════════════════════════════════════════════════════════════
   19 · EXPORTACIÓN PDF (multipágina)
   ══════════════════════════════════════════════════════════════════════ */

function inicializarExportacionPDF() {
    const btnPdf = document.getElementById('btn-export-pdf');
    if (!btnPdf || btnPdf.dataset.ready === '1') return;
    btnPdf.dataset.ready = '1';

    btnPdf.addEventListener('click', () => {
        const { municipio } = APP_CONFIG;

        let mapaBase64 = null;
        let aspectHeight = 220;
        try {
            mapaBase64 = map.getCanvas().toDataURL('image/png');
            const mapaDom = document.getElementById('map');
            if (mapaDom && mapaDom.clientWidth > 0) {
                aspectHeight = Math.round(714 * (mapaDom.clientHeight / mapaDom.clientWidth));
            }
        } catch (err) {
            console.error('[LUX] No se pudo capturar el mapa', err);
        }

        const kpi = id => document.getElementById(id)?.innerText || '0';
        const infoId = document.getElementById('info-id')?.innerText || '-';
        const haySeleccion = infoId && infoId !== '-' && infoId.trim() !== '';

        let tablaFichaHtml = '';
        let enlaceGeoHtml = '';

        if (haySeleccion) {
            const g = id => document.getElementById(id)?.innerText || '-';
            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${window.activoSeleccionadoLat},${window.activoSeleccionadoLon}`;
            enlaceGeoHtml = `
                <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:12px 15px; margin-bottom:20px; font-size:11px;">
                    <div style="font-weight:bold; color:#0369a1; margin-bottom:4px;">Geolocalización:</div>
                    <a href="${mapUrl}" target="_blank" style="color:#0284c7; word-break:break-all; font-weight:bold;">${mapUrl}</a>
                </div>`;

            const valoresFicha = window.activoSeleccionadoConfig?.valores || [];
            const filasHtml = valoresFicha.map((f, i) => {
                const bg = i % 2 === 0 ? '#ffffff' : '#fafaf9';
                return `
                    <tr style="border-bottom:1px solid #f1f5f9; background:${bg};">
                        <td style="padding:8px 12px; color:#64748b; width:40%; font-size:11px;">${f.etiqueta}</td>
                        <td style="padding:8px 12px; font-weight:500; font-size:11px; color:#0f172a;">${f.valor}</td>
                    </tr>`;
            }).join('');

            tablaFichaHtml = `
                <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; margin-bottom:25px;">
                    <div style="background:#f8fafc; padding:10px 15px; border-bottom:1px solid #e2e8f0;">
                        <span style="font-size:11px; font-weight:bold; color:#475569; text-transform:uppercase; letter-spacing:0.05em;">Parámetros del Componente</span>
                        <span style="float:right; font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:4px;">ID: ${infoId}</span>
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <tbody>
                            <tr style="border-bottom:1px solid #f1f5f9; background:#ffffff;">
                                <td style="padding:8px 12px; color:#64748b; width:40%; font-size:11px;">Elemento</td>
                                <td style="padding:8px 12px; font-weight:600; font-size:11px; color:#0f172a;">${g('info-elemento')}</td>
                            </tr>
                            ${filasHtml}
                        </tbody>
                    </table>
                </div>`;
        } else {
            tablaFichaHtml = `<div style="padding:20px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; text-align:center; color:#64748b; font-size:11.5px; margin-bottom:25px;">Reporte general. Haga clic sobre un activo para incluir su ficha técnica.</div>`;
        }

        const printContainer = document.createElement('div');
        Object.assign(printContainer.style, {
            position: 'absolute', left: '-9999px', top: '-9999px',
            width: '794px', backgroundColor: '#fff', padding: '40px',
            fontFamily: 'Archivo, Inter, sans-serif', color: '#1e293b'
        });

        printContainer.innerHTML = `
            <div style="background:#040d3d; color:#fff; margin:-40px -40px 25px -40px; padding:25px 40px; border-bottom:4px solid #5a9cf2;">
                <h1 style="font-size:20px; margin:0 0 5px 0; text-transform:uppercase; letter-spacing:0.03em;">Reporte de Activos Urbanos</h1>
                <p style="font-size:11px; margin:0; color:#94a3b8;">Municipio de ${municipio.nombre} &bull; ${municipio.tituloAplicacion}</p>
            </div>

            <h2 style="font-size:13px; color:#040d3d; border-left:4px solid #5a9cf2; padding-left:8px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px;">Total de Luminarias</h2>
            <div style="display:flex; gap:10px; margin-bottom:25px;">
                <div style="flex:1; background:#ecfeff; border:1px solid #06b6d4; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#0891b2; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Luminarias</div><div style="font-size:16px; font-weight:bold; color:#0891b2;">${kpi('kpi-total')}</div></div>
            </div>

            <h2 style="font-size:13px; color:#040d3d; border-left:4px solid #5a9cf2; padding-left:8px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px;">Vista del Mapa</h2>
            <div style="width:100%; height:${aspectHeight}px; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; margin-bottom:25px; background:#f1f5f9;">
                ${mapaBase64
                    ? `<img src="${mapaBase64}" style="width:100%; height:100%; object-fit:contain; background:#0f172a;" />`
                    : `<div style="padding-top:80px; text-align:center; color:#64748b;">Mapa no disponible</div>`}
            </div>

            <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                <h2 style="font-size:13px; color:#040d3d; border-left:4px solid #5a9cf2; padding-left:8px; text-transform:uppercase; letter-spacing:0.05em; margin:0;">Ficha del Elemento</h2>
                ${enlaceGeoHtml}
            </div>

            ${tablaFichaHtml}

            <div style="padding:12px; background:#f8fafc; border-radius:6px; border-left:4px solid #cbd5e1; font-size:10px; color:#64748b;">
                <strong>Nota:</strong> Generado el ${new Date().toLocaleString('es-AR')}.
            </div>
        `;

        document.body.appendChild(printContainer);

        html2canvas(printContainer, { scale: 2, useCORS: true, logging: false })
            .then(canvas => {
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'mm', 'a4');

                const pageWidth  = pdf.internal.pageSize.getWidth();
                const pageHeight = pdf.internal.pageSize.getHeight();

                const imgWidthPx  = canvas.width;
                const imgHeightPx = canvas.height;

                const imgWidthMm  = pageWidth;
                const imgHeightMm = (imgHeightPx * imgWidthMm) / imgWidthPx;

                const totalPaginas = Math.ceil(imgHeightMm / pageHeight);
                const imgData = canvas.toDataURL('image/jpeg', 0.95);

                for (let pagina = 0; pagina < totalPaginas; pagina++) {
                    const offsetYEnMm = pagina * pageHeight;
                    if (pagina !== 0) pdf.addPage();
                    pdf.addImage(imgData, 'JPEG', 0, -offsetYEnMm, imgWidthMm, imgHeightMm);
                }

                const nombreArchivo = `Reporte_Activos_${haySeleccion ? infoId.replace(/\s+/g, '_') : 'General'}.pdf`;
                pdf.save(nombreArchivo);
                document.body.removeChild(printContainer);
            })
            .catch(err => {
                console.error('[LUX] Error al generar el PDF', err);
                document.body.removeChild(printContainer);
            });
    });
}


/* ══════════════════════════════════════════════════════════════════════
   20 · ARRANQUE
   ══════════════════════════════════════════════════════════════════════ */

aplicarConfiguracionMunicipal();

map.on('load', () => cargarTodosLosGeoJSON());

document.addEventListener('DOMContentLoaded', () => {
    inicializarWidgetCoordenadas();
    inicializarBuscadorOSM();
    inicializarFiltroCategoriasLuminarias();
    inicializarHerramientaBbox();
    inicializarPanelEstadisticas();
    inicializarLeyenda();
    inicializarAcordeonFicha();
    inicializarExportacionPDF();
    inicializarToggleSidebarMobile();
});

function inicializarToggleSidebarMobile() {
    const btn = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.getElementById('technical-sidebar');
    if (!btn || !sidebar) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('is-open');
    });

    document.addEventListener('click', (e) => {
        if (window.innerWidth > 900) return;
        if (!sidebar.classList.contains('is-open')) return;
        if (sidebar.contains(e.target) || btn.contains(e.target)) return;
        sidebar.classList.remove('is-open');
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 900) sidebar.classList.remove('is-open');
    });
}

window.LUX = {
    map,
    get datos() { return datosActuales(); },
    get capas() { return capasData; },
    get filtro() { return filtroActivo; },
    aplicarFiltroDistrito,
    aplicarFiltroPoligono,
    restaurarFiltroPoligono,
    restaurarDatosCompletos,
    calcularKPIs
};