/* ==============================================================
   HuilaConecta · index.js
   Landing pública:
   - Destinos aprobados y guías (GET públicos a la API).
   - Inicio de sesión y registro: el servidor responde con una
     cookie HttpOnly de sesión; aquí no se guarda nada en el navegador.
   - Redirección al panel según el rol.
   ============================================================== */
'use strict';

(() => {
  const { $, api, Validar, escapar, dinero, media, icono } = HC;
  HC.iniciarPagina();

  let destinos = [];
  let categoriaActiva = 'Todas';

  addEventListener('scroll', () => $('#siteHeader').classList.toggle('scrolled', scrollY > 8), { passive: true });

  // Aviso si se llegó aquí porque la sesión expiró
  if (new URLSearchParams(location.search).get('sesion') === 'expirada') {
    HC.notificar('Tu sesión terminó. Inicia sesión de nuevo.', 'error');
    history.replaceState(null, '', 'index.html');
  }

  /** Si ya hay sesión (cookie válida), ofrece volver al panel y aplica el tema guardado. */
  async function revisarSesion() {
    try {
      const u = await api.yo();
      HC.aplicarTema(u.tema || 'light');
      const enlace = $('#btnMiPanel');
      enlace.href = HC.PANEL_POR_ROL[u.rol];
      enlace.hidden = false;
      $('#btnLoginHeader').hidden = true;
      $('#btnRegistroHeader').hidden = true;
    } catch { /* sin sesión: landing normal */ }
  }

  // ============================================================
  //  DESTINOS Y GUÍAS PÚBLICOS
  // ============================================================
  function tarjeta(s) {
    const imagen = media(s.imagenUrl);
    return `<article class="card site-card">
      <div class="site-media">${imagen ? `<img src="${imagen}" alt="Fotografía de ${escapar(s.nombre)}" loading="lazy">` : ''}
        <span class="badge">${escapar(s.categoria)}</span></div>
      <div class="site-body">
        <p class="site-region">${escapar(s.municipio)} · Huila</p>
        <h3 class="site-title">${escapar(s.nombre)}</h3>
        <p class="site-desc">${escapar(s.descripcion)}</p>
        <div class="site-foot"><span class="price">${dinero(s.precio)}</span>
          <button type="button" class="btn btn-soft btn-sm" data-ver="${s.id}">Ver detalles</button></div>
      </div></article>`;
  }

  function pintarDestinos() {
    $('#filtrosLanding').innerHTML = ['Todas', ...HC.CATEGORIAS]
      .map(c => `<button type="button" class="chip" data-cat="${c}" aria-pressed="${c === categoriaActiva}">${c}</button>`).join('');
    const lista = destinos.filter(s => categoriaActiva === 'Todas' || s.categoria === categoriaActiva).slice(0, 6);
    $('#listaDestinos').innerHTML = lista.length ? lista.map(tarjeta).join('') : '<p class="empty">Aún no hay destinos en esta categoría.</p>';
  }

  async function cargarDestinos() {
    try {
      destinos = await api.sitiosAprobados();
      $('#statDestinos').textContent = destinos.length;
      $('#statMunicipios').textContent = new Set(destinos.map(d => d.municipio)).size;
      pintarDestinos();
    } catch (e) {
      $('#listaDestinos').innerHTML = `<p class="empty">No fue posible cargar los destinos. ${escapar(e.message)}</p>`;
    }
  }

  async function cargarGuias() {
    try {
      const guias = await api.guias();
      $('#statGuias').textContent = guias.length;
      $('#listaGuias').innerHTML = guias.slice(0, 3).map(g => {
        const foto = media(g.fotoUrl);
        return `<article class="card guide-card">
          <div class="guide-top">${foto ? `<img class="guide-photo" src="${foto}" alt="" loading="lazy">` : `<span class="guide-photo">${escapar(HC.iniciales(g.nombre))}</span>`}
            <div><h3 style="font-size:1.1rem">${escapar(g.nombre)}</h3><p class="muted small">${escapar(g.especialidad)}</p>
            <span class="stars">${icono('star')} ${Number(g.calificacion).toFixed(1)}</span></div></div>
          <p class="small">${icono('map')} ${escapar(g.municipios)}</p>
          <div class="tags">${g.idiomas.split(',').map(i => `<span class="badge badge-info">${escapar(i.trim())}</span>`).join('')}</div>
        </article>`;
      }).join('') || '<p class="empty">Pronto publicaremos guías locales.</p>';
    } catch (e) {
      $('#listaGuias').innerHTML = `<p class="empty">${escapar(e.message)}</p>`;
    }
  }

  $('#filtrosLanding').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    categoriaActiva = b.dataset.cat;
    pintarDestinos();
    $(`[data-cat="${categoriaActiva}"]`)?.focus();
  });

  // Ficha de detalle pública (incluye mapa si el sitio tiene ubicación)
  const modalDestino = HC.prepararModal($('#modalDestino'));
  $('#listaDestinos').addEventListener('click', e => {
    const b = e.target.closest('[data-ver]');
    if (!b) return;
    const s = destinos.find(x => String(x.id) === b.dataset.ver);
    if (!s) return;
    const imagen = media(s.imagenUrl);
    $('#destinoTitulo').textContent = s.nombre;
    $('#destinoContenido').innerHTML = `${imagen ? `<img class="destino-img" src="${imagen}" alt="Fotografía de ${escapar(s.nombre)}">` : ''}
      <span class="badge">${escapar(s.categoria)} · ${escapar(s.municipio)}</span>
      <p style="margin:14px 0">${escapar(s.descripcion)}</p>
      <p class="price" style="font-size:1.3rem">${dinero(s.precio)}</p>
      ${s.horario ? `<p class="muted small" style="margin-top:6px">${icono('clock')} ${escapar(s.horario)}</p>` : ''}
      ${HC.mapa(s)}
      <div class="modal-actions"><button type="button" class="btn btn-primary" data-auth="registro">Crear cuenta para guardarlo</button></div>`;
    modalDestino.abrir();
  });

  // ============================================================
  //  ACCESO: LOGIN Y REGISTRO
  // ============================================================
  const modalAuth = HC.prepararModal($('#modalAuth'));
  const formLogin = $('#formLogin');
  const formRegistro = $('#formRegistro');

  function mostrarPestana(cual) {
    const esLogin = cual === 'login';
    $('#tabLogin').setAttribute('aria-selected', String(esLogin));
    $('#tabRegistro').setAttribute('aria-selected', String(!esLogin));
    formLogin.hidden = !esLogin;
    formRegistro.hidden = esLogin;
    $('#authTitulo').textContent = esLogin ? 'Bienvenida/o de nuevo' : 'Crea tu cuenta';
    HC.limpiarErrores(esLogin ? formLogin : formRegistro);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-auth]');
    if (!b) return;
    if ($('#modalDestino').open) modalDestino.cerrar();
    mostrarPestana(b.dataset.auth);
    if (b.dataset.rol) formRegistro.elements.rol.value = b.dataset.rol;
    modalAuth.abrir();
    (b.dataset.auth === 'login' ? $('#loginCorreo') : $('#regNombre')).focus();
  });
  $('#tabLogin').addEventListener('click', () => mostrarPestana('login'));
  $('#tabRegistro').addEventListener('click', () => mostrarPestana('registro'));
  $('[data-ir-registro]').addEventListener('click', () => { mostrarPestana('registro'); $('#regNombre').focus(); });
  $('.auth-tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const destino = formLogin.hidden ? 'login' : 'registro';
    mostrarPestana(destino);
    $(destino === 'login' ? '#tabLogin' : '#tabRegistro').focus();
  });

  /** El servidor ya creó la sesión (cookie); solo falta ir al panel del rol. */
  function entrar(usuario) {
    HC.notificar(`¡Hola, ${usuario.nombre.split(' ')[0]}! Abriendo tu panel…`, 'ok');
    setTimeout(() => { location.href = HC.PANEL_POR_ROL[usuario.rol]; }, 400);
  }

  formLogin.addEventListener('submit', async e => {
    e.preventDefault();
    const ok = HC.validarFormulario(formLogin, [
      ['correo', v => v.trim() !== '', 'Escribe tu correo.'],
      ['correo', Validar.correo, 'El formato del correo no es válido.'],
      ['password', v => v !== '', 'Escribe tu contraseña.']
    ]);
    if (!ok) return;
    try {
      const usuario = await HC.conCarga(formLogin.querySelector('[type="submit"]'),
        () => api.login(formLogin.elements.correo.value.trim(), formLogin.elements.password.value));
      formLogin.elements.password.value = '';
      entrar(usuario);
    } catch (err) {
      HC.alertaFormulario(formLogin, err.message);
    }
  });

  const pintarReglas = () => HC.pintarReglasPassword($('#regReglas'), formRegistro.elements.password.value);
  formRegistro.elements.password.addEventListener('input', pintarReglas);
  pintarReglas();

  formRegistro.addEventListener('submit', async e => {
    e.preventDefault();
    const f = formRegistro.elements;
    const ok = HC.validarFormulario(formRegistro, [
      ['nombre', v => v.trim() !== '', 'Escribe tu nombre.'],
      ['nombre', Validar.nombre, 'El nombre solo admite letras (3 a 80 caracteres).'],
      ['correo', v => v.trim() !== '', 'Escribe tu correo.'],
      ['correo', Validar.correo, 'El formato del correo no es válido.'],
      ['telefono', v => v !== '', 'Escribe tu número de celular.'],
      ['telefono', Validar.telefono, 'El celular debe tener exactamente 10 dígitos.'],
      ['password', Validar.password, 'La contraseña no cumple todas las reglas.'],
      ['confirmar', v => v === f.password.value && v !== '', 'Las contraseñas no coinciden.']
    ]);
    if (!ok) return;
    if (!f.terminos.checked) { HC.alertaFormulario(formRegistro, 'Debes aceptar el tratamiento de datos para continuar.'); return; }
    try {
      const usuario = await HC.conCarga(formRegistro.querySelector('[type="submit"]'), () => api.registro({
        nombre: f.nombre.value.trim(), correo: f.correo.value.trim().toLowerCase(),
        telefono: f.telefono.value, password: f.password.value, rol: f.rol.value
      }));
      formRegistro.reset();
      pintarReglas();
      entrar(usuario);
    } catch (err) {
      if (err.status === 409) HC.marcarError(f.correo, err.message);
      HC.alertaFormulario(formRegistro, err.message);
    }
  });

  revisarSesion();
  cargarDestinos();
  cargarGuias();
})();
