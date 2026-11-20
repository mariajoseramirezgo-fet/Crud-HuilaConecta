/* ==============================================================
   HuilaConecta · api.js  (capa de datos y utilidades compartidas)
   --------------------------------------------------------------
   - TODA la información se lee y se guarda en MySQL a través de la
     API REST de Node.js (Express). No se usa localStorage ni sessionStorage.
   - La sesión viaja en una cookie HttpOnly que crea el servidor
     (fetch con credentials: 'include'); JavaScript nunca la toca.
   - Incluye validaciones, filtros de entrada, tema, notificaciones,
     ventanas modales y utilidades de formato usadas por todas las páginas.
   ============================================================== */
'use strict';

const HC = (() => {
  // ============================================================
  //  1. CONFIGURACIÓN DEL ORIGEN DE LA API
  // ============================================================
  /**
   * - Si la página la sirve el backend Node.js (puerto 8080) → misma URL.
   * - Si se abre con Live Server (ej. :5500) → mismo host en el puerto 8080
   *   (localhost con localhost, 127.0.0.1 con 127.0.0.1) para que la cookie funcione.
   */
  const API_ORIGIN = (() => {
    if (location.protocol === 'file:') return 'http://localhost:8080';
    if (location.port === '8080') return location.origin;
    return `${location.protocol}//${location.hostname}:8080`;
  })();
  const API_BASE = API_ORIGIN + '/api';
  const TIMEOUT_MS = 12000;

  const PANEL_POR_ROL = {
    ADMIN: 'admin_dashboard.html',
    EMPRENDEDOR: 'emprendedor_panel.html',
    TURISTA: 'turista_portal.html'
  };
  const CATEGORIAS = ['Experiencias', 'Hospedaje', 'Sabores', 'Transporte'];

  /** Error devuelto por la API (status 0 = sin conexión con el servidor). */
  class ApiError extends Error {
    constructor(mensaje, status = 400) { super(mensaje); this.status = status; }
  }

  // ============================================================
  //  2. CLIENTE HTTP
  // ============================================================

  /**
   * Petición a la API.
   * @param {string} ruta     Ruta relativa a /api (ej. '/sitios/aprobados')
   * @param {object} opciones { method, body (objeto → JSON), form (FormData), sinRedireccion }
   */
  async function http(ruta, { method = 'GET', body, form, sinRedireccion = false } = {}) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), TIMEOUT_MS);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(API_BASE + ruta, {
        method,
        headers,
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
        credentials: 'include',          // envía la cookie de sesión
        signal: control.signal
      });
    } catch (e) {
      mostrarSinConexion(true);
      throw new ApiError('No hay conexión con el servidor. Verifica que el backend esté encendido.', 0);
    } finally {
      clearTimeout(temporizador);
    }
    mostrarSinConexion(false);

    if (res.status === 401 && !sinRedireccion && document.body.dataset.privada === 'true') {
      // La sesión expiró en una página privada: volver al inicio
      location.replace('index.html?sesion=expirada');
      throw new ApiError('Tu sesión terminó.', 401);
    }
    if (!res.ok) {
      const cuerpo = await res.json().catch(() => ({}));
      throw new ApiError(cuerpo.mensaje || `Error del servidor (${res.status}).`, res.status);
    }
    if (res.status === 204) return null;
    const tipo = res.headers.get('Content-Type') || '';
    return tipo.includes('application/json') ? res.json() : res.text();
  }

  const q = params => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
    const s = p.toString();
    return s ? '?' + s : '';
  };

  /** Aviso visible cuando el backend no responde (con botón para reintentar). */
  function mostrarSinConexion(visible) {
    let banner = document.getElementById('bannerSinConexion');
    if (!visible) { if (banner) banner.hidden = true; return; }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'bannerSinConexion';
      banner.className = 'offline-banner';
      banner.setAttribute('role', 'alert');
      banner.innerHTML = `<span><strong>Sin conexión con el servidor.</strong> Inicia el backend (<code>npm start</code> dentro de <code>backend/</code>) y vuelve a intentar.</span>
        <button type="button" class="btn btn-sm btn-light-solid">Reintentar</button>`;
      banner.querySelector('button').addEventListener('click', () => location.reload());
      document.body.prepend(banner);
    }
    banner.hidden = false;
  }

  // ============================================================
  //  3. API REST (una función por endpoint)
  // ============================================================
  const api = {
    // ----- Autenticación (cookie HttpOnly) -----
    login: (correo, password) => http('/auth/login', { method: 'POST', body: { correo, password }, sinRedireccion: true }),
    registro: datos => http('/auth/registro', { method: 'POST', body: datos, sinRedireccion: true }),
    logout: () => http('/auth/logout', { method: 'POST', sinRedireccion: true }),
    yo: () => http('/auth/me', { sinRedireccion: true }),

    // ----- Cuenta propia -----
    actualizarPerfil: datos => http('/usuarios/me', { method: 'PUT', body: datos }),
    actualizarFoto: fotoUrl => http('/usuarios/me/foto', { method: 'PUT', body: { fotoUrl } }),
    cambiarPassword: (actual, nueva) => http('/usuarios/me/password', { method: 'PUT', body: { actual, nueva } }),
    cambiarTema: tema => http('/usuarios/me/tema', { method: 'PUT', body: { tema } }),
    eliminarCuenta: password => http('/usuarios/me', { method: 'DELETE', body: { password } }),

    // ----- Usuarios (administrador) -----
    usuarios: rol => http('/usuarios' + q({ rol })),
    crearUsuario: datos => http('/usuarios', { method: 'POST', body: datos }),
    actualizarUsuario: (id, datos) => http(`/usuarios/${id}`, { method: 'PUT', body: datos }),
    eliminarUsuario: id => http(`/usuarios/${id}`, { method: 'DELETE' }),

    // ----- Archivos (imágenes desde el PC) -----
    subirArchivo: archivo => {
      const form = new FormData();
      form.append('archivo', archivo);
      return http('/archivos', { method: 'POST', form });
    },

    // ----- Sitios turísticos -----
    sitios: (filtros = {}) => http('/sitios' + q(filtros)),
    sitiosAprobados: (filtros = {}) => http('/sitios/aprobados' + q(filtros), { sinRedireccion: true }),
    sitio: id => http(`/sitios/${id}`),
    misSitios: () => http('/sitios/mios'),
    estadisticasSitios: () => http('/sitios/estadisticas'),
    crearSitio: datos => http('/sitios', { method: 'POST', body: datos }),
    actualizarSitio: (id, datos) => http(`/sitios/${id}`, { method: 'PUT', body: datos }),
    eliminarSitio: id => http(`/sitios/${id}`, { method: 'DELETE' }),
    cambiarEstadoSitio: (id, estado, motivo = '') => http(`/sitios/${id}/estado`, { method: 'PATCH', body: { estado, motivo } }),

    // ----- Favoritos (turista) -----
    favoritos: () => http('/usuarios/me/favoritos'),
    agregarFavorito: id => http(`/usuarios/me/favoritos/${id}`, { method: 'POST' }),
    quitarFavorito: id => http(`/usuarios/me/favoritos/${id}`, { method: 'DELETE' }),

    // ----- Galería personal (turista) -----
    fotos: () => http('/usuarios/me/fotos'),
    agregarFoto: (url, descripcion) => http('/usuarios/me/fotos', { method: 'POST', body: { url, descripcion } }),
    editarFoto: (id, descripcion) => http(`/usuarios/me/fotos/${id}`, { method: 'PUT', body: { descripcion } }),
    eliminarFoto: id => http(`/usuarios/me/fotos/${id}`, { method: 'DELETE' }),

    // ----- Guías turísticos -----
    guias: () => http('/guias', { sinRedireccion: true }),
    crearGuia: datos => http('/guias', { method: 'POST', body: datos }),
    actualizarGuia: (id, datos) => http(`/guias/${id}`, { method: 'PUT', body: datos }),
    eliminarGuia: id => http(`/guias/${id}`, { method: 'DELETE' }),

    // ----- Comunidad -----
    muro: () => http('/comunidad/publicaciones'),
    misPublicaciones: () => http('/comunidad/publicaciones/mias'),
    publicar: datos => http('/comunidad/publicaciones', { method: 'POST', body: datos }),
    editarPublicacion: (id, datos) => http(`/comunidad/publicaciones/${id}`, { method: 'PUT', body: datos }),
    eliminarPublicacion: id => http(`/comunidad/publicaciones/${id}`, { method: 'DELETE' }),
    darLike: id => http(`/comunidad/publicaciones/${id}/like`, { method: 'POST' }),
    quitarLike: id => http(`/comunidad/publicaciones/${id}/like`, { method: 'DELETE' }),
    comentar: (id, contenido) => http(`/comunidad/publicaciones/${id}/comentarios`, { method: 'POST', body: { contenido } }),
    eliminarComentario: id => http(`/comunidad/comentarios/${id}`, { method: 'DELETE' }),
    moderacionPublicaciones: estado => http('/comunidad/moderacion/publicaciones' + q({ estado })),
    moderacionComentarios: estado => http('/comunidad/moderacion/comentarios' + q({ estado })),
    moderacionResumen: () => http('/comunidad/moderacion/resumen'),
    moderarPublicacion: (id, estado, motivo = '') => http(`/comunidad/publicaciones/${id}/estado`, { method: 'PATCH', body: { estado, motivo } }),
    moderarComentario: (id, estado) => http(`/comunidad/comentarios/${id}/estado`, { method: 'PATCH', body: { estado } }),

    // ----- Cafetería Sin Fila -----
    menu: sitioId => http(`/productos/sitio/${sitioId}`),
    misProductos: () => http('/productos/mios'),
    crearProducto: datos => http('/productos', { method: 'POST', body: datos }),
    actualizarProducto: (id, datos) => http(`/productos/${id}`, { method: 'PUT', body: datos }),
    disponibilidadProducto: (id, disponible) => http(`/productos/${id}/disponible`, { method: 'PATCH', body: { disponible } }),
    eliminarProducto: id => http(`/productos/${id}`, { method: 'DELETE' }),
    crearPedido: datos => http('/pedidos', { method: 'POST', body: datos }),
    misPedidos: () => http('/pedidos/mios'),
    cancelarPedido: id => http(`/pedidos/${id}/cancelar`, { method: 'POST' }),
    pedidosRecibidos: (activos = false) => http('/pedidos/emprendedor' + q({ activos })),
    cambiarEstadoPedido: (id, estado) => http(`/pedidos/${id}/estado`, { method: 'PATCH', body: { estado } }),
    resumenPagos: () => http('/pedidos/emprendedor/resumen'),
    /** URL del flujo SSE de pedidos en tiempo real (EventSource con cookie). */
    urlStreamPedidos: () => API_BASE + '/pedidos/emprendedor/stream'
  };

  // ============================================================
  //  4. VALIDACIONES (mismas reglas que el backend)
  // ============================================================
  const REGLAS_PASSWORD = [
    ['Mínimo 8 caracteres', v => v.length >= 8],
    ['Una letra mayúscula', v => /[A-ZÁÉÍÓÚÑ]/.test(v)],
    ['Una letra minúscula', v => /[a-záéíóúñ]/.test(v)],
    ['Un número', v => /\d/.test(v)],
    ['Un símbolo (! ? # $ % * …)', v => /[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ\s]/.test(v)],
    ['Sin espacios', v => v.length > 0 && !/\s/.test(v)]
  ];
  const Validar = {
    nombre: v => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]{3,80}$/.test(String(v).trim()),
    correo: v => /^[^\s@]{1,64}@[^\s@]+\.[A-Za-z]{2,}$/.test(String(v).trim()) && String(v).trim().length <= 120,
    correoOpcional: v => !String(v).trim() || Validar.correo(v),
    telefono: v => /^[0-9]{10}$/.test(String(v)),
    celularNequi: v => /^3[0-9]{9}$/.test(String(v)),
    municipio: v => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ .·,-]{3,80}$/.test(String(v).trim()),
    listaPalabras: v => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ .,-]{3,200}$/.test(String(v).trim()),
    entero: (v, min, max) => /^\d+$/.test(String(v)) && Number(v) >= min && Number(v) <= max,
    password: v => typeof v === 'string' && v.length <= 64 && REGLAS_PASSWORD.every(([, f]) => f(v)),
    /** Imagen: vacía, URL http(s) o archivo propio /api/archivos/{id}. */
    imagen: v => !v || /^https?:\/\/\S{4,490}$/.test(v) || /^\/api\/archivos\/\d{1,12}$/.test(v),
    latitud: v => v === '' || (/^-?\d{1,2}(\.\d{1,6})?$/.test(v) && Number(v) >= 1 && Number(v) <= 4),
    longitud: v => v === '' || (/^-?\d{1,2}(\.\d{1,6})?$/.test(v) && Number(v) >= -77 && Number(v) <= -74),
    /** Tarjeta: 16 dígitos y dígito verificador válido (algoritmo de Luhn). */
    tarjeta(v) {
      const n = String(v).replace(/\s/g, '');
      if (!/^\d{16}$/.test(n)) return false;
      let suma = 0;
      for (let i = 0; i < 16; i++) {
        let d = Number(n[15 - i]);
        if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
        suma += d;
      }
      return suma % 10 === 0;
    },
    /** MM/AA vigente. */
    vencimiento(v) {
      const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(String(v));
      if (!m) return false;
      const hoy = new Date();
      const anio = 2000 + Number(m[2]);
      return anio > hoy.getFullYear() || (anio === hoy.getFullYear() && Number(m[1]) >= hoy.getMonth() + 1);
    },
    cvv: v => /^\d{3}$/.test(String(v))
  };

  /**
   * Filtros de entrada en tiempo real (delegados a todo el documento):
   *  - data-solo-numeros → elimina todo lo que no sea dígito (teléfonos, precios, cantidades).
   *  - data-solo-letras  → elimina números y símbolos (nombres, municipios).
   *  - data-decimal      → dígitos, un signo "-" inicial y un punto (coordenadas).
   *  - data-formato="tarjeta"      → agrupa de 4 en 4 (máx. 16 dígitos).
   *  - data-formato="vencimiento"  → MM/AA.
   * maxlength limita la longitud (10 para teléfonos).
   */
  function activarFiltrosDeEntrada() {
    document.addEventListener('input', e => {
      const el = e.target;
      // El error se limpia mientras se escribe (no al salir del campo) para que el
      // formulario no cambie de tamaño justo cuando se hace clic en "Guardar".
      if (el.getAttribute?.('aria-invalid') === 'true') limpiarError(el);
      if (!(el instanceof HTMLInputElement)) return;
      let v = el.value;
      if (el.hasAttribute('data-solo-numeros')) v = v.replace(/\D/g, '');
      else if (el.hasAttribute('data-solo-letras')) v = v.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .·,-]/g, '');
      else if (el.hasAttribute('data-decimal')) {
        v = v.replace(/[^\d.-]/g, '').replace(/(?!^)-/g, '');
        const partes = v.split('.');
        if (partes.length > 2) v = partes.shift() + '.' + partes.join('');
      } else if (el.dataset.formato === 'tarjeta') {
        v = v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
      } else if (el.dataset.formato === 'vencimiento') {
        const d = v.replace(/\D/g, '').slice(0, 4);
        v = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
      }
      if (v !== el.value) el.value = v;
      if (el.getAttribute('aria-invalid') === 'true') limpiarError(el);
    });
    // Bloquea teclas no numéricas antes de que aparezcan
    document.addEventListener('keydown', e => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;
      const soloDigitos = el.hasAttribute('data-solo-numeros') || ['tarjeta', 'vencimiento'].includes(el.dataset.formato);
      if (!soloDigitos || e.ctrlKey || e.metaKey || e.altKey || e.key.length > 1) return;
      if (!/\d/.test(e.key)) e.preventDefault();
    });
    // Casillas "Mostrar contraseña": data-mostrar="idCampo1,idCampo2"
    document.addEventListener('change', e => {
      const caja = e.target;
      if (!(caja instanceof HTMLInputElement) || !caja.dataset.mostrar) return;
      caja.dataset.mostrar.split(',').forEach(id => {
        const campo = document.getElementById(id.trim());
        if (campo) campo.type = caja.checked ? 'text' : 'password';
      });
    });
    // Limpia el error de selects y textareas al cambiar
    document.addEventListener('change', e => {
      if (e.target.getAttribute?.('aria-invalid') === 'true') limpiarError(e.target);
    });
  }

  function marcarError(input, mensaje) {
    input.setAttribute('aria-invalid', 'true');
    const caja = input.closest('.field')?.querySelector('.field-error');
    if (caja) { caja.textContent = mensaje; caja.hidden = false; }
  }
  function limpiarError(input) {
    input.removeAttribute('aria-invalid');
    const caja = input.closest('.field')?.querySelector('.field-error');
    if (caja) { caja.textContent = ''; caja.hidden = true; }
  }
  function limpiarErrores(form) {
    form.querySelectorAll('[aria-invalid="true"]').forEach(limpiarError);
    form.querySelectorAll('.form-alert').forEach(a => { a.hidden = true; a.textContent = ''; });
  }
  /**
   * Valida un formulario con reglas [nombreCampo, condición(valor), mensaje].
   * Marca cada campo inválido, enfoca el primero y devuelve true si todo es válido.
   */
  function validarFormulario(form, reglas) {
    limpiarErrores(form);
    let primero = null;
    for (const [nombre, valido, mensaje] of reglas) {
      const input = form.elements[nombre];
      if (!input || valido(input.value)) continue;
      if (!input.hasAttribute('aria-invalid')) marcarError(input, mensaje);
      primero ??= input;
    }
    primero?.focus();
    return !primero;
  }
  function alertaFormulario(form, mensaje) {
    const alerta = form.querySelector('.form-alert');
    if (alerta) { alerta.textContent = mensaje; alerta.hidden = false; alerta.focus?.(); }
    else notificar(mensaje, 'error');
  }
  /** Lista de reglas de contraseña que se actualiza mientras se escribe. */
  function pintarReglasPassword(lista, valor) {
    lista.innerHTML = REGLAS_PASSWORD.map(([texto, f]) => {
      const ok = f(valor);
      return `<li class="${ok ? 'ok' : ''}"><span aria-hidden="true">${ok ? '✓' : '○'}</span> ${texto}<span class="sr-only">${ok ? ' (cumplido)' : ' (pendiente)'}</span></li>`;
    }).join('');
  }

  // ============================================================
  //  5. FORMATO Y SEGURIDAD AL PINTAR
  // ============================================================
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

  /** Escapa texto antes de insertarlo como HTML (previene XSS). */
  const escapar = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dinero = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const fecha = v => v ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(v)) : '—';
  const fechaHora = v => v ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '—';
  const hora = v => v ? new Intl.DateTimeFormat('es-CO', { timeStyle: 'short' }).format(new Date(v)) : '—';
  /** "hace 5 min", "hace 2 h", o la fecha si es más antiguo. */
  function haceCuanto(v) {
    const seg = (Date.now() - new Date(v).getTime()) / 1000;
    if (seg < 60) return 'hace un momento';
    if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
    if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
    if (seg < 604800) return `hace ${Math.floor(seg / 86400)} d`;
    return fecha(v);
  }
  const iniciales = nombre => String(nombre || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** Convierte una URL guardada en BD en una URL usable en <img> (antepone el servidor a /api/archivos/…). */
  function media(url) {
    if (!url) return '';
    if (/^\/api\/archivos\/\d+$/.test(url)) return escapar(API_ORIGIN + url);
    return /^https?:\/\//i.test(url) ? escapar(url) : '';
  }

  /** Avatar: foto de perfil si existe; si no, iniciales. */
  function avatar(usuario, clase = '') {
    const src = media(usuario?.fotoUrl);
    return src
      ? `<img class="avatar ${clase}" src="${src}" alt="" loading="lazy">`
      : `<span class="avatar ${clase}" aria-hidden="true">${escapar(iniciales(usuario?.nombre))}</span>`;
  }

  /**
   * Mapa de referencia (OpenStreetMap, sin API key) para el detalle de restaurantes y sitios.
   * Si no hay coordenadas muestra un enlace de búsqueda por dirección.
   */
  function mapa(sitio) {
    const lat = Number(sitio.latitud), lon = Number(sitio.longitud);
    const consulta = encodeURIComponent([sitio.direccion, sitio.municipio, 'Huila, Colombia'].filter(Boolean).join(', '));
    if (!sitio.latitud || !sitio.longitud || Number.isNaN(lat) || Number.isNaN(lon)) {
      return `<div class="map-empty">${icono('map')}<div><strong>${escapar(sitio.direccion || sitio.municipio)}</strong>
        <p class="muted small">Ubicación de referencia en ${escapar(sitio.municipio)}, Huila.</p>
        <a class="btn btn-soft btn-sm" href="https://www.google.com/maps/search/?api=1&query=${consulta}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a></div></div>`;
    }
    const d = 0.006;
    const bbox = [lon - d, lat - d, lon + d, lat + d].map(n => n.toFixed(6)).join('%2C');
    return `<figure class="map-box">
      <iframe title="Mapa de ubicación de ${escapar(sitio.nombre)}" loading="lazy" referrerpolicy="no-referrer"
        src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}"></iframe>
      <figcaption><span>${icono('map')} ${escapar(sitio.direccion || sitio.municipio + ', Huila')}</span>
        <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" rel="noopener noreferrer">Cómo llegar</a></figcaption>
    </figure>`;
  }

  // ============================================================
  //  6. ICONOS, NOTIFICACIONES Y VENTANAS
  // ============================================================
  const ICONOS = {
    mountain: '<path d="m2 20 8-15 5 8 3-5 5 12zM7 11l3 2 3-3"/>',
    moon: '<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    search: '<circle cx="10" cy="10" r="7"/><path d="m16 16 5 5"/>',
    heart: '<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-5 5 8 15 8 15S25 10 20 5Z"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="m6 6 12 12M6 18 18 6"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/>',
    store: '<path d="M4 10v10h16V10M3 4h18l-1 6H4zM9 20v-6h6v6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    chart: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
    phone: '<path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14m6-12v14"/>',
    coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1a3 3 0 0 1 0 6h-1M8 3v3m4-3v3"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>',
    link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M4.9 4.9 7 7m10 10 2.1 2.1M2 12h3m14 0h3M4.9 19.1 7 17m10-10 2.1-2.1"/>',
    guide: '<circle cx="12" cy="7" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2M12 14v7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.5 11h11L21 7H6.5"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.6 6.6C3.9 8.3 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'
  };
  const icono = nombre => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONOS[nombre] || ICONOS.compass}</svg>`;
  const pintarIconos = (raiz = document) => $$('[data-icon]', raiz).forEach(el => { el.innerHTML = icono(el.dataset.icon); });

  let temporizadorToast;
  /** Notificación breve. tipo: 'info' | 'ok' | 'error'. */
  function notificar(texto, tipo = 'info') {
    let t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = texto; t.dataset.tipo = tipo; t.hidden = false;
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => { t.hidden = true; }, 4500);
  }

  /** Confirmación accesible (reemplaza a window.confirm). Devuelve una promesa con true/false. */
  function confirmar({ titulo = '¿Confirmas esta acción?', mensaje = '', aceptar = 'Confirmar', peligro = true } = {}) {
    return new Promise(resolver => {
      const d = document.createElement('dialog');
      d.className = 'modal modal-sm';
      d.setAttribute('aria-labelledby', 'confirmTitulo');
      d.innerHTML = `<div class="modal-body"><h2 id="confirmTitulo" style="font-size:1.3rem">${escapar(titulo)}</h2>
        <p class="muted" style="margin-top:10px">${escapar(mensaje)}</p>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-r="0">Cancelar</button>
        <button type="button" class="btn ${peligro ? 'btn-danger' : 'btn-green'}" data-r="1">${escapar(aceptar)}</button></div></div>`;
      document.body.appendChild(d);
      let respuesta = false;
      d.addEventListener('click', e => {
        const b = e.target.closest('[data-r]');
        if (b) { respuesta = b.dataset.r === '1'; d.close(); }
        else if (e.target === d) d.close();
      });
      d.addEventListener('close', () => { d.remove(); resolver(respuesta); });
      d.showModal();
      d.querySelector('[data-r="0"]').focus();
    });
  }

  /** Pide un texto en una ventana (ej. motivo de moderación). Devuelve el texto o null. */
  function pedirTexto({ titulo, etiqueta, minimo = 5, maximo = 255, aceptar = 'Guardar' }) {
    return new Promise(resolver => {
      const d = document.createElement('dialog');
      d.className = 'modal modal-sm';
      d.innerHTML = `<form class="modal-body form" novalidate><h2 style="font-size:1.3rem">${escapar(titulo)}</h2>
        <div class="field"><label for="pedirTextoCampo">${escapar(etiqueta)} <span class="req">*</span></label>
        <textarea class="textarea" id="pedirTextoCampo" name="texto" maxlength="${maximo}" required></textarea>
        <p class="field-hint">Mínimo ${minimo} caracteres.</p><p class="field-error" hidden></p></div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-cancelar>Cancelar</button>
        <button type="submit" class="btn btn-danger">${escapar(aceptar)}</button></div></form>`;
      document.body.appendChild(d);
      let valor = null;
      const form = d.querySelector('form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (!validarFormulario(form, [['texto', v => v.trim().length >= minimo, `Escribe al menos ${minimo} caracteres.`]])) return;
        valor = form.elements.texto.value.trim();
        d.close();
      });
      d.querySelector('[data-cancelar]').addEventListener('click', () => d.close());
      d.addEventListener('close', () => { d.remove(); resolver(valor); });
      d.showModal();
      form.elements.texto.focus();
    });
  }

  /** Prepara un <dialog>: cierre con [data-cerrar], Escape o clic fuera; restaura el foco al cerrar. */
  function prepararModal(dialogo) {
    let disparador = null;
    dialogo.addEventListener('click', e => {
      if (e.target.closest('[data-cerrar]')) dialogo.close();
      else if (e.target === dialogo) {
        const r = dialogo.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialogo.close();
      }
    });
    dialogo.addEventListener('close', () => {
      if (!document.querySelector('dialog[open]')) document.body.style.overflow = '';
      if (disparador?.isConnected) disparador.focus();
    });
    return {
      abrir() { disparador = document.activeElement; document.body.style.overflow = 'hidden'; if (!dialogo.open) dialogo.showModal(); },
      cerrar() { if (dialogo.open) dialogo.close(); }
    };
  }

  /** Deshabilita un botón mientras se ejecuta una operación asíncrona. */
  async function conCarga(boton, tarea) {
    const original = boton.innerHTML;
    boton.disabled = true; boton.textContent = 'Procesando…';
    try { return await tarea(); }
    finally { boton.disabled = false; boton.innerHTML = original; }
  }

  // ============================================================
  //  7. TEMA CLARO / OSCURO (preferencia guardada en MySQL)
  // ============================================================
  let usuarioActual = null;

  function aplicarTema(tema) {
    document.documentElement.dataset.theme = tema;
    $$('[data-tema-toggle]').forEach(b => {
      b.setAttribute('aria-checked', String(tema === 'dark'));
      const etiqueta = b.querySelector('.theme-label');
      if (etiqueta) etiqueta.textContent = tema === 'dark' ? 'Modo claro' : 'Modo oscuro';
      const ico = b.querySelector('[data-icon]');
      if (ico) ico.innerHTML = icono(tema === 'dark' ? 'sun' : 'moon');
    });
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = tema === 'dark' ? '#020617' : '#FFFDF9';
  }

  function iniciarTema() {
    // Sin sesión: preferencia del sistema operativo. Con sesión: la guardada en la BD.
    aplicarTema(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.addEventListener('click', async e => {
      if (!e.target.closest('[data-tema-toggle]')) return;
      const nuevo = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      aplicarTema(nuevo);
      if (usuarioActual) {
        try { usuarioActual = await api.cambiarTema(nuevo); }
        catch { /* el cambio visual se mantiene aunque no se guarde */ }
      }
    });
  }

  // ============================================================
  //  8. INICIALIZACIÓN DE PÁGINAS
  // ============================================================
  function iniciarPagina() {
    // Si una imagen remota no carga, se oculta y queda el fondo de la tarjeta
    document.addEventListener('error', e => {
      if (e.target instanceof HTMLImageElement) e.target.classList.add('img-rota');
    }, true);
    pintarIconos();
    iniciarTema();
    activarFiltrosDeEntrada();
    if (location.protocol === 'file:') {
      notificar('Abre el proyecto desde http://localhost:8080 (o Live Server): con file:// la sesión no funciona.', 'error');
    }
  }

  /**
   * Arranque de un panel privado:
   *  1. Pregunta al servidor quién es el usuario (GET /api/auth/me con la cookie).
   *  2. Sin sesión → index.html. Rol distinto → su propio panel.
   *  3. Aplica el tema guardado, pinta el encabezado y conecta "Cerrar sesión".
   */
  async function iniciarPanel(rolRequerido) {
    document.body.dataset.privada = 'true';
    iniciarPagina();
    let usuario;
    try {
      usuario = await api.yo();
    } catch (e) {
      if (e.status === 401) location.replace('index.html');
      else { $('#main').innerHTML = `<p class="empty" style="margin-top:32px">${escapar(e.message)}</p>`; }
      return null;
    }
    if (usuario.rol !== rolRequerido) { location.replace(PANEL_POR_ROL[usuario.rol]); return null; }
    usuarioActual = usuario;
    aplicarTema(usuario.tema || 'light');
    pintarUsuarioEncabezado(usuario);
    $('#btnSalir')?.addEventListener('click', cerrarSesion);
    document.body.classList.add('listo');
    return usuario;
  }

  /** Actualiza nombre y avatar del encabezado (se usa también tras editar el perfil). */
  function pintarUsuarioEncabezado(usuario) {
    usuarioActual = usuario;
    const nombre = $('#nombreUsuario');
    if (nombre) nombre.textContent = usuario.nombre;
    const caja = $('#avatar');
    if (caja) caja.outerHTML = avatar(usuario).replace('class="avatar ', 'id="avatar" class="avatar ');
  }

  async function cerrarSesion() {
    try { await api.logout(); } catch { /* aunque falle, se sale */ }
    location.href = 'index.html';
  }

  /**
   * Pestañas accesibles (role="tablist"): clic, flechas izquierda/derecha y #hash en la URL.
   * @param {Function} alCambiar  se llama con el nombre de la pestaña abierta
   */
  function pestanas(nav, alCambiar, inicial) {
    const tabs = $$('[data-tab]', nav);
    function abrir(nombre, enfocar = false) {
      if (!tabs.some(t => t.dataset.tab === nombre)) nombre = tabs[0].dataset.tab;
      tabs.forEach(t => {
        const activa = t.dataset.tab === nombre;
        t.setAttribute('aria-selected', String(activa));
        t.tabIndex = activa ? 0 : -1;
        const panel = document.getElementById('sec-' + t.dataset.tab);
        if (panel) panel.hidden = !activa;
        if (activa && enfocar) t.focus();
      });
      history.replaceState(null, '', '#' + nombre);
      alCambiar?.(nombre);
    }
    nav.addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) abrir(t.dataset.tab); });
    nav.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
      abrir(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.tab, true);
    });
    abrir(inicial ?? location.hash.slice(1));
    return { abrir };
  }

  return {
    API_ORIGIN, API_BASE, PANEL_POR_ROL, CATEGORIAS, ApiError, api, Validar, REGLAS_PASSWORD,
    $, $$, escapar, dinero, fecha, fechaHora, hora, haceCuanto, iniciales, normalizar, media, avatar, mapa,
    icono, pintarIconos, notificar, confirmar, pedirTexto, prepararModal, conCarga,
    iniciarPagina, iniciarPanel, pintarUsuarioEncabezado, cerrarSesion, pestanas, aplicarTema,
    marcarError, limpiarError, limpiarErrores, validarFormulario, alertaFormulario, pintarReglasPassword,
    get usuario() { return usuarioActual; }
  };
})();
