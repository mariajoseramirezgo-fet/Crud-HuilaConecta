/* ==============================================================
   HuilaConecta · admin_dashboard.js
   Lógica EXCLUSIVA del Administrador (todo contra la API/MySQL):
   - Resumen con estadísticas por estado y por categoría.
   - CRUD global de usuarios.
   - Moderación de sitios (aprobar / rechazar con motivo).
   - Sitios con filtros avanzados por categoría, estado y texto.
   - Moderación de la comunidad (publicaciones y comentarios).
   - CRUD de guías turísticos.
   - Mi cuenta: foto de perfil, datos y contraseña.
   ============================================================== */
'use strict';

(async () => {
  const yo = await HC.iniciarPanel('ADMIN');
  if (!yo) return;

  const { $, api, Validar, escapar, dinero, fecha, icono, media, avatar, haceCuanto } = HC;

  let usuarios = [];
  let pendientes = [];
  let sitios = [];
  let guias = [];
  let categoriaSitios = '';           // filtro de categoría activo ('' = todas)
  let temporizadorBusqueda;

  const ETIQUETA_ROL = { ADMIN: 'Administrador', EMPRENDEDOR: 'Emprendedor', TURISTA: 'Turista' };
  const CLASE_ESTADO = { APROBADO: 'badge-ok', PENDIENTE: 'badge-warn', RECHAZADO: 'badge-bad' };
  const ETIQUETA_ESTADO = { APROBADO: 'Aprobado', PENDIENTE: 'Pendiente', RECHAZADO: 'Rechazado' };

  // ---------- Pestañas: cada una carga sus datos al abrirse ----------
  const cargadores = {
    resumen: cargarResumen,
    usuarios: cargarUsuarios,
    moderacion: cargarPendientes,
    sitios: cargarSitios,
    comunidad: cargarComunidad,
    guias: cargarGuias,
    cuenta: () => { if (!$('#cuentaAdmin').childElementCount) HC.cuenta($('#cuentaAdmin'), yo); }
  };
  let tabs; // se inicializa al final, cuando todo el módulo está definido
  document.addEventListener('click', e => { const b = e.target.closest('[data-ir]'); if (b) tabs.abrir(b.dataset.ir, true); });

  // ============================================================
  //  RESUMEN
  // ============================================================
  async function cargarResumen() {
    try {
      const [est, lista, com, todos] = await Promise.all([
        api.estadisticasSitios(), api.sitios({ estado: 'PENDIENTE' }), api.moderacionResumen(), api.usuarios()
      ]);
      usuarios = todos;
      pendientes = lista;
      actualizarContador();
      $('#statsResumen').innerHTML = [
        ['Usuarios registrados', todos.length],
        ['Sitios aprobados', est.aprobados],
        ['Sitios pendientes', est.pendientes],
        ['Publicaciones', com.publicaciones]
      ].map(([t, v]) => `<div class="card stat"><p class="stat-value">${v}</p><p class="stat-label">${t}</p></div>`).join('');

      const porCat = est.aprobadosPorCategoria || {};
      const max = Math.max(1, ...Object.values(porCat));
      $('#barrasCategorias').innerHTML = Object.entries(porCat).map(([c, n]) => `<div class="bar-row">
          <div><span>${escapar(c)}</span><strong>${n}</strong></div>
          <div class="bar-track" role="img" aria-label="${escapar(c)}: ${n} sitios"><div class="bar-fill" style="width:${(n / max) * 100}%"></div></div>
        </div>`).join('');

      $('#resumenPendientes').innerHTML = lista.length
        ? lista.slice(0, 3).map(tarjetaModeracion).join('') +
          (lista.length > 3 ? `<button type="button" class="btn btn-soft" data-ir="moderacion">Ver las ${lista.length} pendientes</button>` : '')
        : '<p class="empty">¡Todo al día! No hay sitios esperando revisión.</p>';
    } catch (e) { HC.notificar(e.message, 'error'); }
  }

  function actualizarContador() {
    $('#contadorPendientes').textContent = pendientes.length;
    $('#contadorPendientes').hidden = pendientes.length === 0;
  }

  // ============================================================
  //  USUARIOS · LISTADO (búsqueda en el navegador sobre datos de la API)
  // ============================================================
  async function cargarUsuarios() {
    try { usuarios = await api.usuarios(); pintarUsuarios(); }
    catch (e) { HC.notificar(e.message, 'error'); }
  }

  function pintarUsuarios() {
    const texto = HC.normalizar($('#buscarUsuario').value);
    const rol = $('#filtroRol').value;
    const lista = usuarios.filter(u => (!rol || u.rol === rol) && HC.normalizar(`${u.nombre} ${u.correo} ${u.telefono}`).includes(texto));
    $('#totalUsuarios').textContent = `${lista.length} de ${usuarios.length} usuarios`;
    $('#tablaUsuarios').innerHTML = lista.length ? lista.map(u => `<tr>
        <td class="cell-main" data-label="Usuario"><div style="display:flex;gap:10px;align-items:center">${avatar(u, 'avatar-sm')}
          <div><strong>${escapar(u.nombre)}</strong><span class="cell-sub">${escapar(u.correo)}</span></div></div></td>
        <td data-label="Teléfono">${escapar(u.telefono)}</td>
        <td data-label="Rol"><span class="badge badge-info">${ETIQUETA_ROL[u.rol] || escapar(u.rol)}</span></td>
        <td data-label="Estado"><span class="badge ${u.activo ? 'badge-ok' : 'badge-bad'}">${u.activo ? 'Activa' : 'Inactiva'}</span></td>
        <td data-label="Registro">${fecha(u.fechaRegistro)}</td>
        <td class="cell-actions">
          <button type="button" class="btn btn-soft btn-sm" data-editar-usuario="${u.id}" aria-label="Editar a ${escapar(u.nombre)}">${icono('edit')} Editar</button>
          <button type="button" class="btn btn-danger btn-sm" data-eliminar-usuario="${u.id}" aria-label="Eliminar a ${escapar(u.nombre)}" ${u.id === yo.id ? 'disabled title="No puedes eliminar tu propia cuenta"' : ''}>${icono('trash')} Eliminar</button>
        </td></tr>`).join('')
      : '<tr><td colspan="6" class="cell-main"><p class="empty">No hay usuarios que coincidan con la búsqueda.</p></td></tr>';
  }
  $('#buscarUsuario').addEventListener('input', pintarUsuarios);
  $('#filtroRol').addEventListener('change', pintarUsuarios);

  // ---------- Crear / editar ----------
  const modalUsuario = HC.prepararModal($('#modalUsuario'));
  const formUsuario = $('#formUsuario');
  const reglasUsuario = () => HC.pintarReglasPassword($('#uReglas'), formUsuario.elements.password.value);
  formUsuario.elements.password.addEventListener('input', reglasUsuario);

  function abrirFormularioUsuario(usuario = null) {
    formUsuario.reset();
    HC.limpiarErrores(formUsuario);
    const f = formUsuario.elements;
    const editando = Boolean(usuario);
    $('#usuarioTitulo').textContent = editando ? 'Editar usuario' : 'Nuevo usuario';
    $('#uPasswordHint').hidden = !editando;
    $('#uPasswordLabel').innerHTML = editando ? 'Nueva contraseña (opcional)' : 'Contraseña <span class="req">*</span>';
    f.id.value = usuario?.id ?? '';
    f.nombre.value = usuario?.nombre ?? '';
    f.correo.value = usuario?.correo ?? '';
    f.telefono.value = usuario?.telefono ?? '';
    f.rol.value = usuario?.rol ?? 'TURISTA';
    f.activo.checked = usuario ? usuario.activo : true;
    const esPropio = usuario?.id === yo.id;       // no puede quitarse su rol ni desactivarse
    f.rol.disabled = esPropio;
    f.activo.disabled = esPropio;
    reglasUsuario();
    modalUsuario.abrir();
    f.nombre.focus();
  }
  $('#btnNuevoUsuario').addEventListener('click', () => abrirFormularioUsuario());

  formUsuario.addEventListener('submit', async e => {
    e.preventDefault();
    const f = formUsuario.elements;
    const editando = Boolean(f.id.value);
    const ok = HC.validarFormulario(formUsuario, [
      ['nombre', Validar.nombre, 'El nombre solo admite letras (3 a 80 caracteres).'],
      ['correo', Validar.correo, 'Escribe un correo válido.'],
      ['telefono', Validar.telefono, 'El celular debe tener exactamente 10 dígitos.'],
      ['password', v => (editando && v === '') || Validar.password(v),
        editando ? 'La nueva contraseña no cumple las reglas.' : 'La contraseña es obligatoria y debe cumplir las reglas.']
    ]);
    if (!ok) return;
    const datos = {
      nombre: f.nombre.value.trim(), correo: f.correo.value.trim().toLowerCase(), telefono: f.telefono.value,
      rol: f.rol.value, activo: f.activo.checked, password: f.password.value || null
    };
    try {
      await HC.conCarga(formUsuario.querySelector('[type="submit"]'), () => editando ? api.actualizarUsuario(f.id.value, datos) : api.crearUsuario(datos));
      modalUsuario.cerrar();
      HC.notificar(editando ? 'Usuario actualizado.' : 'Usuario creado correctamente.', 'ok');
      await cargarUsuarios();
    } catch (err) {
      if (err.status === 409) HC.marcarError(f.correo, err.message);
      HC.alertaFormulario(formUsuario, err.message);
    }
  });

  $('#tablaUsuarios').addEventListener('click', async e => {
    const editar = e.target.closest('[data-editar-usuario]');
    const eliminar = e.target.closest('[data-eliminar-usuario]');
    if (editar) abrirFormularioUsuario(usuarios.find(u => String(u.id) === editar.dataset.editarUsuario));
    if (!eliminar) return;
    const u = usuarios.find(x => String(x.id) === eliminar.dataset.eliminarUsuario);
    const extra = u.rol === 'EMPRENDEDOR' ? ' También se eliminarán sus sitios, menú, pedidos recibidos y publicaciones.' : '';
    if (!await HC.confirmar({ titulo: `¿Eliminar a ${u.nombre}?`, mensaje: 'Esta acción no se puede deshacer.' + extra, aceptar: 'Eliminar usuario' })) return;
    try {
      await api.eliminarUsuario(u.id);
      HC.notificar('Usuario eliminado.', 'ok');
      await cargarUsuarios();
    } catch (err) { HC.notificar(err.message, 'error'); }
  });

  // ============================================================
  //  MODERACIÓN DE SITIOS
  // ============================================================
  function tarjetaModeracion(s) {
    const imagen = media(s.imagenUrl);
    return `<article class="card row-card">
      ${imagen ? `<img src="${imagen}" alt="Fotografía de ${escapar(s.nombre)}" loading="lazy">` : '<div class="site-media" aria-hidden="true"></div>'}
      <div class="row-body">
        <div><span class="badge badge-warn">Pendiente</span> <span class="badge badge-info">${escapar(s.categoria)}</span></div>
        <h3 style="font-size:1.2rem">${escapar(s.nombre)}</h3>
        <p class="muted small">${escapar(s.municipio)} · ${dinero(s.precio)} · Tel. ${escapar(s.telefono)} · Por ${escapar(s.emprendedorNombre || '—')}</p>
        <p class="small">${escapar(s.descripcion)}</p>
        ${s.direccion ? `<p class="muted small">${icono('map')} ${escapar(s.direccion)}${s.latitud ? ` (${s.latitud}, ${s.longitud})` : ''}</p>` : ''}
        <div class="row-actions">
          <button type="button" class="btn btn-green btn-sm" data-aprobar="${s.id}">${icono('check')} Aprobar</button>
          <button type="button" class="btn btn-danger btn-sm" data-rechazar="${s.id}">${icono('x')} Rechazar</button>
        </div>
      </div></article>`;
  }

  async function cargarPendientes() {
    try {
      pendientes = await api.sitios({ estado: 'PENDIENTE' });
      actualizarContador();
      $('#listaModeracion').innerHTML = pendientes.length ? pendientes.map(tarjetaModeracion).join('')
        : '<p class="empty">No hay sitios pendientes. ¡Buen trabajo!</p>';
    } catch (e) { HC.notificar(e.message, 'error'); }
  }

  /** Aprobar y rechazar funcionan desde Resumen, Moderación y la tabla de sitios. */
  document.addEventListener('click', async e => {
    const aprobar = e.target.closest('[data-aprobar]');
    const rechazar = e.target.closest('[data-rechazar]');
    if (!aprobar && !rechazar) return;
    try {
      if (aprobar) {
        await HC.conCarga(aprobar, () => api.cambiarEstadoSitio(aprobar.dataset.aprobar, 'APROBADO'));
        HC.notificar('Sitio aprobado: ya es visible para los turistas.', 'ok');
      } else {
        const motivo = await HC.pedirTexto({ titulo: 'Rechazar publicación', etiqueta: 'Motivo (lo verá el emprendedor)', aceptar: 'Rechazar' });
        if (!motivo) return;
        await api.cambiarEstadoSitio(rechazar.dataset.rechazar, 'RECHAZADO', motivo);
        HC.notificar('Sitio rechazado. El emprendedor verá el motivo.', 'ok');
      }
      await recargarVisible();
    } catch (err) { HC.notificar(err.message, 'error'); }
  });

  /** Recarga la pestaña abierta y el contador de pendientes. */
  async function recargarVisible() {
    const abierta = document.querySelector('.tab[aria-selected="true"]')?.dataset.tab;
    await cargadores[abierta]?.();
    if (abierta !== 'moderacion' && abierta !== 'resumen') {
      pendientes = await api.sitios({ estado: 'PENDIENTE' });
      actualizarContador();
    }
  }

  // ============================================================
  //  SITIOS · FILTROS AVANZADOS (categoría + estado + texto en el servidor)
  // ============================================================
  $('#filtroCategorias').innerHTML = [['', 'Todas'], ...HC.CATEGORIAS.map(c => [c, c === 'Experiencias' ? 'Experiencia' : c])]
    .map(([v, t]) => `<button type="button" class="chip" data-cat="${v}" aria-pressed="${v === ''}">${t}</button>`).join('');

  $('#filtroCategorias').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    categoriaSitios = b.dataset.cat;
    HC.$$('[data-cat]', $('#filtroCategorias')).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    cargarSitios();
  });
  $('#filtroEstado').addEventListener('change', cargarSitios);
  $('#buscarSitio').addEventListener('input', () => { clearTimeout(temporizadorBusqueda); temporizadorBusqueda = setTimeout(cargarSitios, 300); });

  async function cargarSitios() {
    try {
      sitios = await api.sitios({ categoria: categoriaSitios, estado: $('#filtroEstado').value, q: $('#buscarSitio').value.trim() });
      pintarSitios();
    } catch (e) { HC.notificar(e.message, 'error'); }
  }

  function pintarSitios() {
    const filtros = [categoriaSitios, ETIQUETA_ESTADO[$('#filtroEstado').value]].filter(Boolean).join(' · ');
    $('#totalSitios').textContent = `${sitios.length} sitio(s)${filtros ? ' · ' + filtros : ''}`;
    $('#tablaSitios').innerHTML = sitios.length ? sitios.map(s => `<tr>
        <td class="cell-main" data-label="Sitio"><strong>${escapar(s.nombre)}</strong><span class="cell-sub">${escapar(s.municipio)}</span></td>
        <td data-label="Categoría">${escapar(s.categoria)}</td>
        <td data-label="Emprendedor">${escapar(s.emprendedorNombre || '—')}</td>
        <td data-label="Precio">${dinero(s.precio)}</td>
        <td data-label="Estado"><span class="badge ${CLASE_ESTADO[s.estado]}">${ETIQUETA_ESTADO[s.estado]}</span></td>
        <td class="cell-actions">
          ${s.estado !== 'APROBADO' ? `<button type="button" class="btn btn-green btn-sm" data-aprobar="${s.id}">${icono('check')} Aprobar</button>` : ''}
          ${s.estado !== 'RECHAZADO' ? `<button type="button" class="btn btn-soft btn-sm" data-rechazar="${s.id}">${icono('x')} Rechazar</button>` : ''}
          <button type="button" class="btn btn-danger btn-sm" data-eliminar-sitio="${s.id}" aria-label="Eliminar ${escapar(s.nombre)}">${icono('trash')}</button>
        </td></tr>`).join('')
      : '<tr><td colspan="6" class="cell-main"><p class="empty">No hay sitios con estos filtros.</p></td></tr>';
  }

  $('#tablaSitios').addEventListener('click', async e => {
    const b = e.target.closest('[data-eliminar-sitio]');
    if (!b) return;
    const s = sitios.find(x => String(x.id) === b.dataset.eliminarSitio);
    if (!await HC.confirmar({ titulo: `¿Eliminar "${s.nombre}"?`, mensaje: 'Se borrarán también su menú, sus pedidos y los favoritos asociados.', aceptar: 'Eliminar sitio' })) return;
    try { await api.eliminarSitio(s.id); HC.notificar('Sitio eliminado.', 'ok'); await cargarSitios(); }
    catch (err) { HC.notificar(err.message, 'error'); }
  });

  // ============================================================
  //  COMUNIDAD · MODERACIÓN DE PUBLICACIONES Y COMENTARIOS
  // ============================================================
  const tipoContenido = () => document.querySelector('input[name="tipoContenido"]:checked').value;
  document.querySelectorAll('input[name="tipoContenido"]').forEach(r => r.addEventListener('change', cargarComunidad));
  $('#filtroModeracion').addEventListener('change', cargarComunidad);

  async function cargarComunidad() {
    try {
      const estado = $('#filtroModeracion').value;
      const [resumen, lista] = await Promise.all([
        api.moderacionResumen(),
        tipoContenido() === 'publicaciones' ? api.moderacionPublicaciones(estado) : api.moderacionComentarios(estado)
      ]);
      $('#statsComunidad').innerHTML = [
        ['Publicaciones', resumen.publicaciones], ['Publicaciones ocultas', resumen.publicacionesOcultas],
        ['Comentarios', resumen.comentarios], ['Comentarios ocultos', resumen.comentariosOcultos]
      ].map(([t, v]) => `<div class="card stat"><p class="stat-value">${v}</p><p class="stat-label">${t}</p></div>`).join('');
      $('#listaComunidad').innerHTML = lista.length
        ? lista.map(tipoContenido() === 'publicaciones' ? itemPublicacion : itemComentario).join('')
        : '<p class="empty">No hay contenido con este filtro.</p>';
    } catch (e) { HC.notificar(e.message, 'error'); }
  }

  const badgeEstado = estado => `<span class="badge ${estado === 'VISIBLE' ? 'badge-ok' : 'badge-bad'}">${estado === 'VISIBLE' ? 'Visible' : 'Oculta'}</span>`;

  function itemPublicacion(p) {
    const img = media(p.imagenUrl);
    return `<article class="card mod-item">
      <div class="mod-meta">${avatar(p.autor, 'avatar-sm')}<strong>${escapar(p.autor.nombre)}</strong>
        <span class="muted small">${haceCuanto(p.fecha)} · ${p.totalLikes} me gusta · ${p.totalComentarios} comentario(s)</span> ${badgeEstado(p.estado)}</div>
      <p class="post-text">${escapar(p.contenido)}</p>
      ${img ? `<img class="post-img" style="max-height:220px" src="${img}" alt="Imagen de la publicación" loading="lazy">` : ''}
      ${p.motivoModeracion ? `<p class="note note-bad"><strong>Motivo:</strong> ${escapar(p.motivoModeracion)}</p>` : ''}
      ${p.comentarios.length ? `<details><summary class="small">Ver ${p.comentarios.length} comentario(s)</summary>
        <ul class="comments" style="margin-top:10px">${p.comentarios.map(c => `<li class="comment">${avatar(c.autor, 'avatar-sm')}
          <div class="comment-body"><strong>${escapar(c.autor.nombre)}</strong> ${badgeEstado(c.estado)}<p>${escapar(c.contenido)}</p></div></li>`).join('')}</ul></details>` : ''}
      <div class="row-actions">
        ${p.estado === 'VISIBLE'
          ? `<button type="button" class="btn btn-soft btn-sm" data-ocultar-pub="${p.id}">${icono('eyeOff')} Ocultar</button>`
          : `<button type="button" class="btn btn-green btn-sm" data-mostrar-pub="${p.id}">${icono('eye')} Restaurar</button>`}
        <button type="button" class="btn btn-danger btn-sm" data-borrar-pub="${p.id}">${icono('trash')} Eliminar</button>
      </div></article>`;
  }

  function itemComentario(c) {
    return `<article class="card mod-item">
      <div class="mod-meta">${avatar(c.autor, 'avatar-sm')}<strong>${escapar(c.autor.nombre)}</strong>
        <span class="muted small">${haceCuanto(c.fecha)} · en la publicación #${c.publicacionId}</span> ${badgeEstado(c.estado)}</div>
      <p>${escapar(c.contenido)}</p>
      <div class="row-actions">
        ${c.estado === 'VISIBLE'
          ? `<button type="button" class="btn btn-soft btn-sm" data-ocultar-com="${c.id}">${icono('eyeOff')} Ocultar</button>`
          : `<button type="button" class="btn btn-green btn-sm" data-mostrar-com="${c.id}">${icono('eye')} Restaurar</button>`}
        <button type="button" class="btn btn-danger btn-sm" data-borrar-com="${c.id}">${icono('trash')} Eliminar</button>
      </div></article>`;
  }

  $('#listaComunidad').addEventListener('click', async e => {
    const d = e.target.closest('button')?.dataset;
    if (!d) return;
    try {
      if (d.ocultarPub) {
        const motivo = await HC.pedirTexto({ titulo: 'Ocultar publicación', etiqueta: 'Motivo (lo verá el autor)', aceptar: 'Ocultar' });
        if (!motivo) return;
        await api.moderarPublicacion(d.ocultarPub, 'OCULTA', motivo);
      } else if (d.mostrarPub) {
        await api.moderarPublicacion(d.mostrarPub, 'VISIBLE');
      } else if (d.borrarPub) {
        if (!await HC.confirmar({ titulo: '¿Eliminar la publicación?', mensaje: 'Se borrarán sus comentarios y "Me gusta".', aceptar: 'Eliminar' })) return;
        await api.eliminarPublicacion(d.borrarPub);
      } else if (d.ocultarCom) {
        await api.moderarComentario(d.ocultarCom, 'OCULTA');
      } else if (d.mostrarCom) {
        await api.moderarComentario(d.mostrarCom, 'VISIBLE');
      } else if (d.borrarCom) {
        if (!await HC.confirmar({ titulo: '¿Eliminar el comentario?', aceptar: 'Eliminar' })) return;
        await api.eliminarComentario(d.borrarCom);
      } else return;
      HC.notificar('Moderación aplicada.', 'ok');
      await cargarComunidad();
    } catch (err) { HC.notificar(err.message, 'error'); }
  });

  // ============================================================
  //  GUÍAS TURÍSTICOS · CRUD
  // ============================================================
  const modalGuia = HC.prepararModal($('#modalGuia'));
  const formGuia = $('#formGuia');
  const fotoGuia = HC.selectorImagen($('#gFoto'), { etiqueta: 'Foto del guía' });

  async function cargarGuias() {
    try {
      guias = await api.guias();
      $('#tablaGuias').innerHTML = guias.length ? guias.map(g => `<tr>
          <td class="cell-main" data-label="Guía"><div style="display:flex;gap:10px;align-items:center">${avatar(g, 'avatar-sm')}
            <div><strong>${escapar(g.nombre)}</strong><span class="cell-sub">${escapar(g.especialidad)} · ★ ${Number(g.calificacion).toFixed(1)}</span></div></div></td>
          <td data-label="Municipios">${escapar(g.municipios)}</td>
          <td data-label="Idiomas">${escapar(g.idiomas)}</td>
          <td data-label="Tarifa/día">${dinero(g.tarifaDia)}</td>
          <td data-label="Estado"><span class="badge ${g.activo ? 'badge-ok' : 'badge-bad'}">${g.activo ? 'Visible' : 'Oculto'}</span></td>
          <td class="cell-actions">
            <button type="button" class="btn btn-soft btn-sm" data-editar-guia="${g.id}">${icono('edit')} Editar</button>
            <button type="button" class="btn btn-danger btn-sm" data-eliminar-guia="${g.id}" aria-label="Eliminar a ${escapar(g.nombre)}">${icono('trash')}</button>
          </td></tr>`).join('')
        : '<tr><td colspan="6" class="cell-main"><p class="empty">Aún no hay guías registrados.</p></td></tr>';
    } catch (e) { HC.notificar(e.message, 'error'); }
  }

  function abrirGuia(g = null) {
    formGuia.reset();
    HC.limpiarErrores(formGuia);
    const f = formGuia.elements;
    $('#guiaTitulo').textContent = g ? 'Editar guía' : 'Nuevo guía';
    f.id.value = g?.id ?? '';
    ['nombre', 'especialidad', 'idiomas', 'municipios', 'telefono', 'correo', 'rnt', 'descripcion'].forEach(k => { f[k].value = g?.[k] ?? ''; });
    f.experienciaAnios.value = g?.experienciaAnios ?? '';
    f.tarifaDia.value = g ? String(Math.round(g.tarifaDia)) : '';
    f.calificacion.value = g ? Number(g.calificacion).toFixed(1) : '';
    f.activo.checked = g ? g.activo : true;
    fotoGuia.establecer(g?.fotoUrl);
    modalGuia.abrir();
    f.nombre.focus();
  }
  $('#btnNuevoGuia').addEventListener('click', () => abrirGuia());

  formGuia.addEventListener('submit', async e => {
    e.preventDefault();
    const f = formGuia.elements;
    const ok = HC.validarFormulario(formGuia, [
      ['nombre', Validar.nombre, 'El nombre solo admite letras (3 a 80 caracteres).'],
      ['especialidad', v => v.trim().length >= 3, 'Escribe la especialidad (mínimo 3 caracteres).'],
      ['idiomas', Validar.listaPalabras, 'Escribe los idiomas separados por comas.'],
      ['municipios', Validar.listaPalabras, 'Escribe los municipios separados por comas.'],
      ['experienciaAnios', v => Validar.entero(v, 0, 60), 'Escribe un número entre 0 y 60.'],
      ['tarifaDia', v => Validar.entero(v, 10000, 5000000), 'La tarifa debe estar entre 10.000 y 5.000.000.'],
      ['calificacion', v => /^[1-5](\.\d)?$/.test(v) && Number(v) <= 5, 'Escribe una calificación entre 1.0 y 5.0.'],
      ['telefono', Validar.telefono, 'El celular debe tener exactamente 10 dígitos.'],
      ['correo', Validar.correoOpcional, 'El correo no es válido.'],
      ['rnt', v => v === '' || /^\d{4,10}$/.test(v), 'El RNT debe tener entre 4 y 10 dígitos.'],
      ['descripcion', v => v.trim().length >= 20, 'La descripción debe tener al menos 20 caracteres.']
    ]);
    if (!ok || !fotoGuia.valido()) return;
    const datos = {
      nombre: f.nombre.value.trim(), especialidad: f.especialidad.value.trim(), idiomas: f.idiomas.value.trim(),
      municipios: f.municipios.value.trim(), experienciaAnios: Number(f.experienciaAnios.value), tarifaDia: Number(f.tarifaDia.value),
      calificacion: Number(f.calificacion.value), telefono: f.telefono.value, correo: f.correo.value.trim() || null,
      rnt: f.rnt.value || null, descripcion: f.descripcion.value.trim(), fotoUrl: fotoGuia.valor(), activo: f.activo.checked
    };
    try {
      await HC.conCarga(formGuia.querySelector('[type="submit"]'), () => f.id.value ? api.actualizarGuia(f.id.value, datos) : api.crearGuia(datos));
      modalGuia.cerrar();
      HC.notificar('Guía guardado.', 'ok');
      await cargarGuias();
    } catch (err) { HC.alertaFormulario(formGuia, err.message); }
  });

  $('#tablaGuias').addEventListener('click', async e => {
    const editar = e.target.closest('[data-editar-guia]');
    const eliminar = e.target.closest('[data-eliminar-guia]');
    if (editar) abrirGuia(guias.find(g => String(g.id) === editar.dataset.editarGuia));
    if (!eliminar) return;
    const g = guias.find(x => String(x.id) === eliminar.dataset.eliminarGuia);
    if (!await HC.confirmar({ titulo: `¿Eliminar a ${g.nombre}?`, mensaje: 'Dejará de aparecer en el portal del turista.', aceptar: 'Eliminar guía' })) return;
    try { await api.eliminarGuia(g.id); HC.notificar('Guía eliminado.', 'ok'); await cargarGuias(); }
    catch (err) { HC.notificar(err.message, 'error'); }
  });

  // ---------- Arranque: abre la pestaña del #hash (o Resumen) ----------
  tabs = HC.pestanas($('.app-tabs'), nombre => cargadores[nombre]?.());

  // Contador de pendientes siempre visible en la pestaña
  if (!['resumen', 'moderacion'].includes(location.hash.slice(1) || 'resumen')) {
    api.sitios({ estado: 'PENDIENTE' }).then(l => { pendientes = l; actualizarContador(); }).catch(() => {});
  }
})();
