/* ==============================================================
   HuilaConecta · emprendedor_panel.js
   Lógica EXCLUSIVA del Emprendedor (todo contra la API/MySQL):
   - Mis servicios: CRUD con imagen (URL o archivo del PC) y ubicación.
   - Cafetería Sin Fila: pedidos en tiempo real (SSE), resumen de pagos y menú.
   - Comunidad: publicar, comentar y "Me gusta".
   - Configuración: foto de perfil, datos y contraseña.
   ============================================================== */
'use strict';

(async () => {
  const yo = await HC.iniciarPanel('EMPRENDEDOR');
  if (!yo) return;

  const { $, $$, api, Validar, escapar, dinero, fecha, hora, icono, media, haceCuanto } = HC;

  let misSitios = [];
  let filtro = 'TODOS';
  let productos = [];
  let pedidos = [];
  let idsConocidos = null;   // para resaltar pedidos nuevos
  let comunidadIniciada = false;
  let tabs;

  const ESTADOS_SITIO = {
    TODOS: ['Todos', ''], APROBADO: ['Aprobados', 'badge-ok'],
    PENDIENTE: ['En revisión', 'badge-warn'], RECHAZADO: ['Rechazados', 'badge-bad']
  };

  $('#saludo').textContent = `Hola, ${yo.nombre.split(' ')[0]}`;

  // ============================================================
  //  MIS SERVICIOS · LEER
  // ============================================================
  async function cargarSitios() {
    try {
      misSitios = await api.misSitios();
      pintarSitios();
    } catch (e) {
      $('#listaSitios').innerHTML = `<p class="empty">No se pudieron cargar tus servicios. ${escapar(e.message)}</p>`;
    }
  }

  function pintarSitios() {
    const cuenta = estado => misSitios.filter(s => s.estado === estado).length;
    $('#statsEmprendedor').innerHTML = [
      ['Publicaciones', misSitios.length], ['Aprobadas', cuenta('APROBADO')],
      ['En revisión', cuenta('PENDIENTE')], ['Rechazadas', cuenta('RECHAZADO')]
    ].map(([t, v]) => `<div class="card stat"><p class="stat-value">${v}</p><p class="stat-label">${t}</p></div>`).join('');

    $('#filtrosEstado').innerHTML = Object.entries(ESTADOS_SITIO)
      .map(([clave, [texto]]) => `<button type="button" class="chip" data-filtro="${clave}" aria-pressed="${clave === filtro}">${texto}</button>`).join('');

    const lista = misSitios.filter(s => filtro === 'TODOS' || s.estado === filtro);
    $('#totalSitios').textContent = `${lista.length} servicio(s)`;
    $('#listaSitios').innerHTML = lista.length ? lista.map(tarjetaSitio).join('')
      : `<div class="empty"><p>${misSitios.length ? 'No tienes servicios con este estado.' : 'Aún no has publicado servicios.'}</p>
         ${misSitios.length ? '' : '<button type="button" class="btn btn-primary" data-nuevo style="margin-top:12px">Publicar mi primer servicio</button>'}</div>`;
  }

  function tarjetaSitio(s) {
    const [etiqueta, clase] = ESTADOS_SITIO[s.estado];
    const imagen = media(s.imagenUrl);
    return `<article class="card row-card">
      ${imagen ? `<img src="${imagen}" alt="Fotografía de ${escapar(s.nombre)}" loading="lazy">` : '<div class="site-media" aria-hidden="true"></div>'}
      <div class="row-body">
        <div><span class="badge ${clase}">${etiqueta}</span> <span class="badge badge-info">${escapar(s.categoria)}</span></div>
        <h2 style="font-size:1.25rem">${escapar(s.nombre)}</h2>
        <p class="muted small">${escapar(s.municipio)} · ${dinero(s.precio)} · Tel. ${escapar(s.telefono)} · Actualizado ${fecha(s.fechaActualizacion)}</p>
        <p class="small">${escapar(s.descripcion)}</p>
        ${s.direccion || s.latitud ? `<p class="muted small">${icono('map')} ${escapar(s.direccion || 'Con coordenadas')}${s.latitud ? ' · ubicada en el mapa' : ''}</p>` : ''}
        ${s.estado === 'RECHAZADO' && s.motivoRechazo ? `<p class="note note-bad"><strong>Motivo del rechazo:</strong> ${escapar(s.motivoRechazo)}<br>Edita la publicación para enviarla de nuevo a revisión.</p>` : ''}
        ${s.estado === 'APROBADO' ? '<p class="note note-info">Visible en el catálogo de turistas y en la página pública.</p>' : ''}
        <div class="row-actions">
          <button type="button" class="btn btn-soft btn-sm" data-editar="${s.id}">${icono('edit')} Editar</button>
          <button type="button" class="btn btn-danger btn-sm" data-eliminar="${s.id}">${icono('trash')} Eliminar</button>
          ${s.categoria === 'Sabores' ? `<button type="button" class="btn btn-ghost btn-sm" data-ver-menu>${icono('coffee')} Gestionar menú</button>` : ''}
        </div>
      </div></article>`;
  }

  $('#filtrosEstado').addEventListener('click', e => {
    const b = e.target.closest('[data-filtro]');
    if (!b) return;
    filtro = b.dataset.filtro;
    pintarSitios();
    $(`[data-filtro="${filtro}"]`)?.focus();
  });

  // ============================================================
  //  MIS SERVICIOS · CREAR / EDITAR (imagen por URL o archivo, ubicación)
  // ============================================================
  const modalSitio = HC.prepararModal($('#modalSitio'));
  const formSitio = $('#formSitio');
  const fs = formSitio.elements;
  const imagenSitio = HC.selectorImagen($('#sImagen'), { etiqueta: 'Imagen del sitio o producto' });
  const contador = () => { $('#contadorDescripcion').textContent = fs.descripcion.value.length; };
  fs.descripcion.addEventListener('input', contador);

  function abrirSitio(s = null) {
    formSitio.reset();
    HC.limpiarErrores(formSitio);
    $('#sitioTitulo').textContent = s ? 'Editar servicio' : 'Publicar servicio';
    $('#avisoEdicion').hidden = !s;
    fs.id.value = s?.id ?? '';
    ['nombre', 'categoria', 'municipio', 'descripcion', 'direccion', 'horario'].forEach(k => { fs[k].value = s?.[k] ?? ''; });
    fs.precio.value = s ? String(Math.round(Number(s.precio))) : '';
    fs.telefono.value = s?.telefono ?? yo.telefono ?? '';
    fs.latitud.value = s?.latitud ?? '';
    fs.longitud.value = s?.longitud ?? '';
    imagenSitio.establecer(s?.imagenUrl);
    $('#vistaMapa').innerHTML = '';
    contador();
    modalSitio.abrir();
    fs.nombre.focus();
  }

  // Vista previa del mapa con las coordenadas escritas
  $('#btnVistaMapa').addEventListener('click', () => {
    if (!Validar.latitud(fs.latitud.value) || !Validar.longitud(fs.longitud.value)) {
      HC.validarFormulario(formSitio, [
        ['latitud', Validar.latitud, 'Latitud fuera del Huila (1 a 4).'],
        ['longitud', Validar.longitud, 'Longitud fuera del Huila (−77 a −74).']
      ]);
      return;
    }
    $('#vistaMapa').innerHTML = HC.mapa({ nombre: fs.nombre.value || 'tu sitio', direccion: fs.direccion.value,
      municipio: fs.municipio.value || 'Huila', latitud: fs.latitud.value, longitud: fs.longitud.value });
  });

  formSitio.addEventListener('submit', async e => {
    e.preventDefault();
    const ok = HC.validarFormulario(formSitio, [
      ['nombre', v => v.trim().length >= 3 && v.trim().length <= 100, 'El nombre debe tener entre 3 y 100 caracteres.'],
      ['categoria', v => HC.CATEGORIAS.includes(v), 'Selecciona una categoría.'],
      ['municipio', Validar.municipio, 'El municipio solo admite letras (mínimo 3).'],
      ['precio', v => /^\d+$/.test(v), 'Escribe el precio solo con números.'],
      ['precio', v => Validar.entero(v, 1000, 50000000), 'El precio debe estar entre 1.000 y 50.000.000.'],
      ['telefono', Validar.telefono, 'El teléfono debe tener exactamente 10 dígitos.'],
      ['descripcion', v => v.trim().length >= 20, 'La descripción debe tener al menos 20 caracteres.'],
      ['latitud', Validar.latitud, 'Latitud fuera del Huila (1 a 4, hasta 6 decimales).'],
      ['longitud', Validar.longitud, 'Longitud fuera del Huila (−77 a −74, hasta 6 decimales).'],
      ['longitud', v => (v === '') === (fs.latitud.value === ''), 'Escribe latitud y longitud juntas, o deja ambas vacías.']
    ]);
    if (!ok || !imagenSitio.valido()) return;

    const datos = {
      nombre: fs.nombre.value.trim(), categoria: fs.categoria.value, municipio: fs.municipio.value.trim(),
      precio: Number(fs.precio.value), telefono: fs.telefono.value, descripcion: fs.descripcion.value.trim(),
      imagenUrl: imagenSitio.valor(), direccion: fs.direccion.value.trim() || null, horario: fs.horario.value.trim() || null,
      latitud: fs.latitud.value === '' ? null : Number(fs.latitud.value),
      longitud: fs.longitud.value === '' ? null : Number(fs.longitud.value)
    };
    const editando = Boolean(fs.id.value);
    try {
      await HC.conCarga(formSitio.querySelector('[type="submit"]'), () => editando ? api.actualizarSitio(fs.id.value, datos) : api.crearSitio(datos));
      modalSitio.cerrar();
      HC.notificar(editando ? 'Cambios guardados. Tu servicio está de nuevo en revisión.' : 'Servicio enviado a revisión del administrador.', 'ok');
      filtro = 'TODOS';
      await cargarSitios();
    } catch (err) { HC.alertaFormulario(formSitio, err.message); }
  });

  document.addEventListener('click', e => { if (e.target.closest('#btnNuevoSitio, [data-nuevo]')) abrirSitio(); });

  $('#listaSitios').addEventListener('click', async e => {
    const editar = e.target.closest('[data-editar]');
    const eliminar = e.target.closest('[data-eliminar]');
    if (e.target.closest('[data-ver-menu]')) { tabs.abrir('cafeteria'); abrirSub('menu'); return; }
    if (editar) abrirSitio(misSitios.find(s => String(s.id) === editar.dataset.editar));
    if (!eliminar) return;
    const s = misSitios.find(x => String(x.id) === eliminar.dataset.eliminar);
    if (!await HC.confirmar({ titulo: `¿Eliminar "${s.nombre}"?`, mensaje: 'Se borrarán también su menú y sus pedidos. No se puede deshacer.', aceptar: 'Eliminar servicio' })) return;
    try { await api.eliminarSitio(s.id); HC.notificar('Servicio eliminado.', 'ok'); await cargarSitios(); }
    catch (err) { HC.notificar(err.message, 'error'); }
  });

  // ============================================================
  //  CAFETERÍA SIN FILA · SUBSECCIONES
  // ============================================================
  let subActiva = 'pedidos';
  function abrirSub(nombre) {
    subActiva = nombre;
    $$('[data-sub]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sub === nombre)));
    $$('[data-subpanel]').forEach(p => { p.hidden = p.dataset.subpanel !== nombre; });
    ({ pedidos: cargarPedidos, pagos: cargarPagos, menu: cargarMenu })[nombre]();
  }
  $('.sub-tabs').addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (b) abrirSub(b.dataset.sub); });

  // ---------- Pedidos en vivo (tablero por estado) ----------
  const COLUMNAS = [
    ['PENDIENTE', 'Nuevos', 'EN_PREPARACION', 'Empezar a preparar'],
    ['EN_PREPARACION', 'En preparación', 'LISTO', 'Marcar listo'],
    ['LISTO', 'Listos para recoger', 'ENTREGADO', 'Entregado']
  ];
  const METODO = { TARJETA: 'Tarjeta', NEQUI: 'Nequi', EFECTIVO: 'Efectivo' };
  const PAGO = { PAGADO: ['Pagado', 'badge-ok'], PENDIENTE: ['Cobrar al entregar', 'badge-warn'], REEMBOLSADO: ['Reembolsado', 'badge-bad'] };

  async function cargarPedidos() {
    try {
      pedidos = await api.pedidosRecibidos(true);
      const nuevos = idsConocidos ? pedidos.filter(p => !idsConocidos.has(p.id)).map(p => p.id) : [];
      idsConocidos = new Set(pedidos.map(p => p.id));
      $('#contadorPedidos').textContent = pedidos.length;
      $('#contadorPedidos').hidden = pedidos.length === 0;
      if (subActiva === 'pedidos') pintarKanban(nuevos);
    } catch (e) { HC.notificar(e.message, 'error'); }
  }

  function pintarKanban(nuevos = []) {
    $('#kanban').innerHTML = COLUMNAS.map(([estado, titulo, siguiente, accion]) => {
      const lista = pedidos.filter(p => p.estado === estado);
      return `<section class="kanban-col" aria-label="${titulo}">
        <h3>${titulo} <span class="badge">${lista.length}</span></h3>
        ${lista.length ? lista.map(p => tarjetaPedido(p, siguiente, accion, nuevos.includes(p.id))).join('') : '<p class="muted small">Sin pedidos.</p>'}
      </section>`;
    }).join('');
  }

  function tarjetaPedido(p, siguiente, accion, esNuevo) {
    const [pago, clasePago] = PAGO[p.estadoPago];
    return `<article class="card order ${esNuevo ? 'is-new' : ''}">
      <div class="order-head"><div><p class="order-code">${escapar(p.codigo)}</p>
        <p class="muted small">${escapar(p.clienteNombre)} · ${escapar(p.sitioNombre)}</p></div>
        <span class="badge ${clasePago}">${pago}</span></div>
      <ul class="order-items">${p.items.map(i => `<li><span>${i.cantidad} × ${escapar(i.nombreProducto)}</span><span>${dinero(i.subtotal)}</span></li>`).join('')}</ul>
      ${p.notas ? `<p class="note note-info small">“${escapar(p.notas)}”</p>` : ''}
      <p class="small"><strong>${dinero(p.total)}</strong> · ${METODO[p.metodoPago]} · ${icono('clock')} recoge ${hora(p.recogerEn)} <span class="muted">(${haceCuanto(p.fecha)})</span></p>
      <div class="row-actions">
        <button type="button" class="btn btn-green btn-sm" data-avanzar="${p.id}" data-a="${siguiente}">${icono('check')} ${accion}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cancelar-pedido="${p.id}">Cancelar</button>
      </div></article>`;
  }

  $('#kanban').addEventListener('click', async e => {
    const avanzar = e.target.closest('[data-avanzar]');
    const cancelar = e.target.closest('[data-cancelar-pedido]');
    try {
      if (avanzar) {
        await HC.conCarga(avanzar, () => api.cambiarEstadoPedido(avanzar.dataset.avanzar, avanzar.dataset.a));
        if (avanzar.dataset.a === 'ENTREGADO') HC.notificar('Pedido entregado. ¡Buen trabajo!', 'ok');
      } else if (cancelar) {
        const p = pedidos.find(x => String(x.id) === cancelar.dataset.cancelarPedido);
        const reembolso = p.estadoPago === 'PAGADO' ? ` Se reembolsarán ${dinero(p.total)} al cliente.` : '';
        if (!await HC.confirmar({ titulo: `¿Cancelar el pedido ${p.codigo}?`, mensaje: 'El cliente verá el pedido como cancelado.' + reembolso, aceptar: 'Cancelar pedido' })) return;
        await api.cambiarEstadoPedido(p.id, 'CANCELADO');
      } else return;
      await cargarPedidos();
    } catch (err) { HC.notificar(err.message, 'error'); }
  });

  /**
   * Tiempo real: EventSource abre una conexión SSE con la cookie de sesión.
   * Cada evento "pedido" vuelve a consultar la lista. Si la conexión falla,
   * se usa consulta periódica cada 15 s como respaldo.
   */
  let sondeo = null;
  function conectarTiempoReal() {
    const indicador = $('#estadoVivo');
    if (!('EventSource' in window)) return activarSondeo();
    const fuente = new EventSource(api.urlStreamPedidos(), { withCredentials: true });
    fuente.addEventListener('conectado', () => {
      indicador.dataset.estado = 'vivo';
      indicador.textContent = 'En vivo';
      if (sondeo) { clearInterval(sondeo); sondeo = null; }
    });
    fuente.addEventListener('pedido', ev => {
      const datos = JSON.parse(ev.data || '{}');
      if (datos.nuevo) HC.notificar(`🔔 Nuevo pedido ${datos.codigo}`, 'ok');
      cargarPedidos();
      if (subActiva === 'pagos') cargarPagos();
    });
    fuente.onerror = () => { indicador.dataset.estado = 'sondeo'; indicador.textContent = 'Reconectando…'; activarSondeo(); };
  }
  function activarSondeo() {
    if (sondeo) return;
    sondeo = setInterval(() => { if (!document.hidden) cargarPedidos(); }, 15000);
  }

  // ---------- Resumen de pagos ----------
  async function cargarPagos() {
    try {
      const r = await api.resumenPagos();
      $('#statsPagos').innerHTML = [
        ['Ventas de hoy', dinero(r.ventasHoy)], ['Últimos 7 días', dinero(r.ventasSemana)],
        ['Este mes', dinero(r.ventasMes)], ['Total cobrado', dinero(r.totalPagado)],
        ['Por cobrar (efectivo)', dinero(r.porCobrarEfectivo)], ['Reembolsado', dinero(r.reembolsado)],
        ['Pedidos de hoy', r.pedidosHoy], ['Ticket promedio', dinero(r.ticketPromedio)]
      ].map(([t, v]) => `<div class="card stat"><p class="stat-value" style="font-size:1.35rem">${v}</p><p class="stat-label">${t}</p></div>`).join('');
      $('#barrasMetodo').innerHTML = barras(Object.entries(r.porMetodo).map(([k, v]) => [METODO[k] || k, v]));
      $('#barrasSitio').innerHTML = barras(Object.entries(r.porSitio)) || '<p class="muted small">Aún no hay ventas.</p>';
      $('#tablaPagos').innerHTML = r.movimientos.length ? r.movimientos.map(m => {
        const [pago, clase] = PAGO[m.estadoPago];
        return `<tr>
          <td class="cell-main" data-label="Pedido"><strong>${escapar(m.codigo)}</strong><span class="cell-sub">${escapar(m.sitio)} · ${HC.fechaHora(m.fecha)}</span></td>
          <td data-label="Cliente">${escapar(m.cliente)}</td>
          <td data-label="Método">${METODO[m.metodo]} ${m.detalleMetodo ? `<span class="cell-sub">${escapar(m.detalleMetodo)}</span>` : ''}</td>
          <td data-label="Referencia">${escapar(m.referencia || '—')}</td>
          <td data-label="Estado del pago"><span class="badge ${clase}">${pago}</span></td>
          <td data-label="Total"><strong>${dinero(m.total)}</strong></td></tr>`;
      }).join('') : '<tr><td colspan="6" class="cell-main"><p class="empty">Aún no hay movimientos.</p></td></tr>';
    } catch (e) { HC.notificar(e.message, 'error'); }
  }

  function barras(pares) {
    const max = Math.max(1, ...pares.map(([, v]) => Number(v)));
    return pares.map(([k, v]) => `<div class="bar-row"><div><span>${escapar(k)}</span><strong>${dinero(v)}</strong></div>
      <div class="bar-track" role="img" aria-label="${escapar(k)}: ${dinero(v)}"><div class="bar-fill" style="width:${(Number(v) / max) * 100}%"></div></div></div>`).join('');
  }

  // ---------- Menú (CRUD de productos) ----------
  const modalProducto = HC.prepararModal($('#modalProducto'));
  const formProducto = $('#formProducto');
  const fp = formProducto.elements;
  const imagenProducto = HC.selectorImagen($('#pImagen'), { etiqueta: 'Foto del producto' });
  const restaurantes = () => misSitios.filter(s => s.categoria === 'Sabores');

  async function cargarMenu() {
    try {
      [productos, misSitios] = await Promise.all([api.misProductos(), api.misSitios()]);
      if (!restaurantes().length) {
        $('#listaMenu').innerHTML = '<div class="empty"><p>Para usar Cafetería Sin Fila publica primero un servicio en la categoría <strong>Sabores</strong>.</p></div>';
        $('#btnNuevoProducto').disabled = true;
        return;
      }
      $('#btnNuevoProducto').disabled = false;
      $('#listaMenu').innerHTML = restaurantes().map(s => {
        const lista = productos.filter(p => p.sitioId === s.id);
        return `<div class="card card-pad"><h2 class="card-title">${icono('coffee')} ${escapar(s.nombre)}
            ${s.estado !== 'APROBADO' ? '<span class="badge badge-warn">Visible cuando se apruebe el sitio</span>' : ''}</h2>
          <div class="menu-list">${lista.length ? lista.map(itemMenu).join('') : '<p class="muted small">Sin productos aún.</p>'}</div></div>`;
      }).join('');
    } catch (e) { HC.notificar(e.message, 'error'); }
  }

  function itemMenu(p) {
    const img = media(p.imagenUrl);
    return `<div class="card menu-item ${p.disponible ? '' : 'agotado'}">
      ${img ? `<img src="${img}" alt="" loading="lazy">` : '<span class="menu-ph" aria-hidden="true"></span>'}
      <div class="menu-info"><strong>${escapar(p.nombre)}</strong>
        <p class="muted small">${escapar(p.descripcion || '')}</p><p class="price">${dinero(p.precio)}</p></div>
      <div class="row-actions" style="margin:0;justify-content:flex-end">
        <label class="check small"><input type="checkbox" data-disponible="${p.id}" ${p.disponible ? 'checked' : ''}> ${p.disponible ? 'Disponible' : 'Agotado'}</label>
        <button type="button" class="btn btn-soft btn-icon btn-sm" data-editar-producto="${p.id}" aria-label="Editar ${escapar(p.nombre)}">${icono('edit')}</button>
        <button type="button" class="btn btn-danger btn-icon btn-sm" data-eliminar-producto="${p.id}" aria-label="Eliminar ${escapar(p.nombre)}">${icono('trash')}</button>
      </div></div>`;
  }

  function abrirProducto(p = null) {
    formProducto.reset();
    HC.limpiarErrores(formProducto);
    $('#productoTitulo').textContent = p ? 'Editar producto' : 'Nuevo producto';
    fp.sitioId.innerHTML = restaurantes().map(s => `<option value="${s.id}">${escapar(s.nombre)}</option>`).join('');
    fp.id.value = p?.id ?? '';
    if (p) fp.sitioId.value = p.sitioId;
    fp.nombre.value = p?.nombre ?? '';
    fp.precio.value = p ? String(Math.round(p.precio)) : '';
    fp.descripcion.value = p?.descripcion ?? '';
    fp.disponible.checked = p ? p.disponible : true;
    imagenProducto.establecer(p?.imagenUrl);
    modalProducto.abrir();
    fp.nombre.focus();
  }
  $('#btnNuevoProducto').addEventListener('click', () => abrirProducto());

  formProducto.addEventListener('submit', async e => {
    e.preventDefault();
    const ok = HC.validarFormulario(formProducto, [
      ['sitioId', v => v !== '', 'Selecciona el restaurante.'],
      ['nombre', v => v.trim().length >= 3, 'El nombre debe tener al menos 3 caracteres.'],
      ['precio', v => Validar.entero(v, 500, 1000000), 'El precio debe ser un número entre 500 y 1.000.000.']
    ]);
    if (!ok || !imagenProducto.valido()) return;
    const datos = {
      sitioId: Number(fp.sitioId.value), nombre: fp.nombre.value.trim(), precio: Number(fp.precio.value),
      descripcion: fp.descripcion.value.trim() || null, imagenUrl: imagenProducto.valor(), disponible: fp.disponible.checked
    };
    try {
      await HC.conCarga(formProducto.querySelector('[type="submit"]'), () => fp.id.value ? api.actualizarProducto(fp.id.value, datos) : api.crearProducto(datos));
      modalProducto.cerrar();
      HC.notificar('Producto guardado.', 'ok');
      await cargarMenu();
    } catch (err) { HC.alertaFormulario(formProducto, err.message); }
  });

  $('#listaMenu').addEventListener('click', async e => {
    const editar = e.target.closest('[data-editar-producto]');
    const eliminar = e.target.closest('[data-eliminar-producto]');
    if (editar) abrirProducto(productos.find(p => String(p.id) === editar.dataset.editarProducto));
    if (!eliminar) return;
    const p = productos.find(x => String(x.id) === eliminar.dataset.eliminarProducto);
    if (!await HC.confirmar({ titulo: `¿Eliminar "${p.nombre}"?`, mensaje: 'El historial de pedidos conservará su nombre y precio.', aceptar: 'Eliminar' })) return;
    try { await api.eliminarProducto(p.id); await cargarMenu(); }
    catch (err) { HC.notificar(err.message, 'error'); }
  });
  $('#listaMenu').addEventListener('change', async e => {
    const caja = e.target.closest('[data-disponible]');
    if (!caja) return;
    try { await api.disponibilidadProducto(caja.dataset.disponible, caja.checked); await cargarMenu(); }
    catch (err) { caja.checked = !caja.checked; HC.notificar(err.message, 'error'); }
  });

  // ============================================================
  //  PESTAÑAS Y ARRANQUE
  // ============================================================
  tabs = HC.pestanas($('.app-tabs'), nombre => {
    if (nombre === 'servicios') cargarSitios();
    if (nombre === 'cafeteria') abrirSub(subActiva);
    if (nombre === 'comunidad' && !comunidadIniciada) { comunidadIniciada = true; HC.comunidad($('#comunidad'), { usuario: yo, puedePublicar: true }); }
    if (nombre === 'cuenta' && !$('#cuenta').childElementCount) HC.cuenta($('#cuenta'), yo, u => { $('#saludo').textContent = `Hola, ${u.nombre.split(' ')[0]}`; });
  });

  // Los pedidos se vigilan desde el inicio, aunque la pestaña de cafetería esté cerrada
  if (!misSitios.length) misSitios = await api.misSitios().catch(() => []);
  await cargarPedidos();
  conectarTiempoReal();
})();
