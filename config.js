/* ============================================================================
   LUX VISION · CONFIGURACIÓN MUNICIPAL — TUPUNGATO
   ============================================================================ */

window.LUX_CONFIG = {

  /* ── 1 · IDENTIDAD DEL MUNICIPIO ─────────────────────────────────────── */
  municipio: {
    nombre: 'Tupungato',
    tituloAplicacion: 'Monitoreo de Activos Urbanos',
    locale: 'es-AR',
    mapaInicial: { center: [-69.14, -33.37], zoom: 13 },
    branding: {
      logoLux:       { src: 'logo_lux_byn.png',   href: 'https://www.luxleasing.com.ar/' },
      logoMunicipio: { src: 'logo_tupungato.png', href: 'https://www.tupungato.gob.ar/' }
    }
  },

  /* ── 2 · FUENTES DE DATOS ────────────────────────────────────────────── */
  fuentes: {
    luminarias: './luminarias_tupungato_wgs84.geojson',
    distritos:  './distritos_tupungato_wgs.geojson'
  },

  /* ── 3 · ATRIBUTOS GLOBALES ──────────────────────────────────────────── */
  camposGlobales: {
    fechaActualizacion: ['FECHA_ACT', '_server_up', '_updated_b', 'fecha_act'],
    distritoNombre:     ['nombre', 'NOMBRE', 'distrito', 'DISTRITO', 'name']
  },

  /* ── 4 · PALETA CROMÁTICA ÚNICA ──────────────────────────────────────── */
  simbologia: {
    luminarias:  { LED: '#22d3ee', SAP: '#e2f916', OTROS: '#e6b290' },
    seleccion: {
      CENTRO: '#31fff5',
      ANILLO: '#22d3ee',
      ZONA_BORDE:   '#0f172a',
      ZONA_HALO:    '#ffffff',
      ZONA_RELLENO: '#0a5864',
      ZONA_VERTICE: '#ffffff'
    }
  },

  /* ── 5 · UI / HERRAMIENTAS ───────────────────────────────────────────── */
  ui: {
    coordenadas: { decimales: 6, mostrarProyectadas: false },
    decimales: { kmFichaLateral: 2 },
    busqueda: {
      url: 'https://nominatim.openstreetmap.org/search',
      params: { format: 'jsonv2', limit: 6, addressdetails: 0, 'accept-language': 'es' },
      debounceMs: 400,
      viewbox: '-69.35,-33.25,-68.95,-33.50',
      bounded: 1,
      zoomResultado: 17,
      reverseUrl: 'https://nominatim.openstreetmap.org/reverse',
      reverseGeocode: true
    },
    seleccionBBox: { color: '#22d3ee', relleno: 'rgba(34,211,238,0.08)' },
    filtroDistrito: {
      bufferMetros: 0,
      zoomAlFiltrar: { padding: 60, duracionMs: 900, maxZoom: 16 }
    }
  },

  /* ── 6 · DEFINICIÓN DE CAPAS ─────────────────────────────────────────── */
  capas: {
    luminarias: {
      id: 'luminarias-layer',
      source: 'luminarias-source',
      label: 'Luminarias',
      elementoFijo: 'Luminaria',
      idCampo: ['ID', '_title', 'n_medidor'],
      simbologiaCampo: ['TECNOLOGIA', 'tecnologia'],

      // Campos principales en la ficha (los más relevantes)
      fichaPrimaria: [
        { etiqueta: 'ID',           campos: ['ID'] },
        { etiqueta: 'Elemento',     campos: ['ELEMENTO'] },
        { etiqueta: 'Tecnología',   campos: ['TECNOLOGIA'] },
        { etiqueta: 'Potencia',     campos: ['POTENCIA'] },
        { etiqueta: 'Soporte',      campos: ['SOPORTE'] },
        { etiqueta: 'Función',      campos: ['FUNCION'] },
        { etiqueta: 'Zona',         campos: ['ZONA'] },
        { etiqueta: 'Medidor',      campos: ['MEDIDOR'] }
      ],

      // Campos secundarios (se muestran al hacer clic en "Ver más campos")
      fichaSecundaria: [
        { etiqueta: 'ID Marca',     campos: ['ID_MARCA'] },
        { etiqueta: 'Marca',        campos: ['MARCA'] },
        { etiqueta: 'Modelo',       campos: ['MODELO'] },
        { etiqueta: 'Calle',        campos: ['CALLE'] },
        { etiqueta: 'Fecha Act.',   campos: ['FECHA_ACT'] },
        { etiqueta: 'Fecha Reca.',  campos: ['FECHA_RECA'] },
        { etiqueta: 'Street View',  campos: ['STREETVIEW'] },
        { etiqueta: 'Link ST_V',    campos: ['LINK_ST_V'] },
        { etiqueta: 'Brazo',        campos: ['BRAZO'] },
        { etiqueta: 'Coord. X',     campos: ['X'] },
        { etiqueta: 'Coord. Y',     campos: ['Y'] }
      ],

      kpis: {
        tecnologia: {
          campo: ['TECNOLOGIA', 'tecnologia'],
          grupos: {
            'LED': (v) => String(v).toUpperCase().includes('LED'),
            'SAP': (v) => String(v).toUpperCase().includes('SAP'),
            'OTROS': () => true
          }
        },
        potencia: { campo: ['POTENCIA', 'potencia'] }
      }
    }
  },

  /* ── 7 · ESTADÍSTICAS ────────────────────────────────────────────────── */
  estadisticas: {
    economia: {
      vidaUtilLedAnios: 5,
      anchoPromedioVia: 10,
      tarifaKwh: 85
    },
    alertas: {
      porcentajeSapCritico: 30,
      porcentajeLedPorVencer: 20
    },
    luminarias: { precioReconversionPorPunto: 85000 }
  }
};