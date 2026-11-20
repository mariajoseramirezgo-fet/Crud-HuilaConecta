/* ==============================================================
   HuilaConecta · turista_portal.js
   Lógica EXCLUSIVA del Turista / Estudiante (todo contra la API/MySQL):
   - Explorar: catálogo con búsqueda en tiempo real, filtros y detalle con mapa.
   - Guías turísticos: listado y ficha detallada.
   - Comida sin fila: menú, carrito en memoria, pasarela de pago simulada y "Mis pedidos".
   - Comunidad: comentarios y "Me gusta".
   - Favoritos y perfil (galería personal, foto, datos, contraseña, eliminar cuenta).
   ============================================================== */
'use strict';

(async () => {
  const yo = await HC.iniciarPanel('TURISTA');
  if (!yo) return;

  const { $, $$, api, Validar, escapar, dinero, icono, media, hora, haceCuanto } = HC;

  let catalogo = [];
  let favoritos = new Set();
  let categoria = 'Todas';
  let guias = [];
  let restauranteId = null;
  let menu = [];
  const carrito = new Map();           // productoId → cantidad (solo en memoria, no se persiste en el navegador)
  let misPedidos = [];
  let sondeoPedidos = null;
  let comunidadIniciada = false;
  let tabs;
  let temporizadorBusqueda;

  $('#saludo').textContent = `¡Hola, ${yo.nombre.split(' ')[0]}! 👋`;

  // ============================================================
  //  EXPLORAR · CATÁLOGO
  // ============================================================
  async function cargarCatalogo() {
    try {
      const [sitios, favs] = await Promise.all([api.sitiosAprobados(), api.favoritos()]);
      catalogo = sitios;
      favoritos = new Set(favs.map(s => s.id));
      pintarCatalogo();
      pintarContadorFavoritos();
    } catch (e) {
      $('#catalogo').innerHTML = `<p class="empty">No se pudo cargar el catálogo. ${escapar(e.message)}</p>`;
    }
  }

  function tarjeta(s) {
    const esFav = favoritos.has(s.id);
    const imagen = media(s.imagenUrl);
    return `<article class="card site-card">
      <div class="site-media">${imagen ? `<img src="${imagen}" alt="Fotografía de ${escapar(s.nombre)}" loading="lazy">` : ''}
        <span class="badge">${escapar(s.categoria)}</span>
        <button type="button" class="site-fav" data-fav="${s.id}" aria-pressed="${esFav}" aria-label="${esFav ? 'Quitar de' : 'Guardar en'} favoritos: ${escapar(s.nombre)}">${icono('heart')}</button>
      </div>
      <div class="site-body">
        <p class="site-region">${escapar(s.municipio)} · Huila</p>
        <h3 class="site-title">${escapar(s.nombre)}</h3>
        <p class="site-desc">${escapar(s.descripcion)}</p>
        <div class="site-foot"><span class="price">${dinero(s.precio)}</span>
          <button type="button" class="btn btn-soft btn-sm" data-detalle="${s.id}">${s.categoria === 'Sabores' ? 'Ver restaurante' : 'Ver detalles'} ${icono('arrow')}</button></div>
      </div></article>`;
  }

  /** Búsqueda en tiempo real: filtra al escribir (sin tildes ni mayúsculas). */
  function pintarCatalogo() {
    const texto = HC.normalizar($('#buscador').value.trim());
    $('#filtrosCategoria').innerHTML = ['Todas', ...HC.CATEGORIAS]
      .map(c => `<button type="button" class="chip" data-cat="${c}" aria-pressed="${c === categoria}">${c}</button>`).join('');
    const orden = {
      'precio-asc': (a, b) => a.precio - b.precio,
      'precio-desc': (a, b) => b.precio - a.precio,
      'nombre': (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
      'recientes': () => 0
    }[$('#orden').value];
    const lista = catalogo
      .filter(s => (categoria === 'Todas' || s.categoria === categoria) &&
        HC.normalizar(`${s.nombre} ${s.municipio} ${s.categoria} ${s.descripcion}`).includes(texto))
      .sort(orden);
    const termino = $('#buscador').value.trim();
    $('#totalResultados').textContent = `${lista.length} resultado(s)${termino ? ` para “${termino}”` : ''}`;
    $('#catalogo').innerHTML = lista.length ? lista.map(tarjeta).join('')
      : '<p class="empty">No encontramos resultados. Prueba otra palabra o categoría.</p>';
  }

  $('#buscador').addEventListener('input', () => { clearTimeout(temporizadorBusqueda); temporizadorBusqueda = setTimeout(pintarCatalogo, 150); });
  $('#orden').addEventListener('change', pintarCatalogo);
  $('#filtrosCategoria').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    categoria = b.dataset.cat;
    pintarCatalogo();
    $(`[data-cat="${categoria}"]`)?.focus();
  });

  // ============================================================
  //  FAVORITOS
  // ============================================================
  function pintarContadorFavoritos() {
    $('#contadorFavoritos').textContent = favoritos.size;
    $('#contadorFavoritos').hidden = favoritos.size === 0;
  }
  function pintarFavoritos() {
    const lista = catalogo.filter(s => favoritos.has(s.id));
    $('#listaFavoritos').innerHTML = lista.length ? lista.map(tarjeta).join('')
      : '<div class="empty"><p>Aún no tienes favoritos. Toca el corazón ♥ de un destino para guardarlo.</p><button type="button" class="btn btn-primary" data-ir="explorar" style="margin-top:12px">Explorar destinos</button></div>';
  }
  async function alternarFavorito(boton) {
    const id = Number(boton.dataset.fav);
    const era = favoritos.has(id);
    boton.disabled = true;
    try {
      if (era) await api.quitarFavorito(id); else await api.agregarFavorito(id);
      era ? favoritos.delete(id) : favoritos.add(id);
      pintarContadorFavoritos();
      pintarCatalogo();
      if (!$('#sec-favoritos').hidden) pintarFavoritos();
      HC.notificar(era ? 'Quitado de tus favoritos.' : 'Guardado en tus favoritos ♥', 'ok');
    } catch (e) { HC.notificar(e.message, 'error'); }
    finally { boton.disabled = false; }
  }

  // ============================================================
  //  DETALLE DE SITIO / RESTAURANTE (con mapa)
  // ============================================================
  const modalDetalle = HC.prepararModal($('#modalDetalle'));

  async function abrirDetalle(id) {
    const s = catalogo.find(x => x.id === Number(id));
    if (!s) return;
    const imagen = media(s.imagenUrl);
    const esFav = favoritos.has(s.id);
    const esRestaurante = s.categoria === 'Sabores';
    $('#detalleTitulo').textContent = s.nombre;
    $('#detalleContenido').innerHTML = `
      ${imagen ? `<img src="${imagen}" alt="Fotografía de ${escapar(s.nombre)}" class="destino-img" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px;margin-bottom:14px">` : ''}
      <span class="badge">${escapar(esRestaurante ? 'Restaurante · Cafetería' : s.categoria)} · ${escapar(s.municipio)}</span>
      <p style="margin:14px 0">${escapar(s.descripcion)}</p>
      <p class="price" style="font-size:1.3rem">${esRestaurante ? 'Desde ' : ''}${dinero(s.precio)}</p>
      <ul class="info-list">
        ${s.direccion ? `<li>${icono('map')}<span>${escapar(s.direccion)}</span></li>` : ''}
        ${s.horario ? `<li>${icono('clock')}<span>${escapar(s.horario)}</span></li>` : ''}
        <li>${icono('phone')}<span>${escapar(s.telefono)} · Prestador: ${escapar(s.emprendedorNombre || 'Emprendedor local')}</span></li>
      </ul>
      ${HC.mapa(s)}
      ${esRestaurante ? '<div id="detalleMenu" style="margin-top:16px"><p class="muted small">Cargando menú…</p></div>' : ''}
      <div class="modal-actions">
        <a class="btn btn-ghost" href="tel:+57${escapar(s.telefono)}">${icono('phone')} Llamar</a>
        <a class="btn btn-green" href="https://wa.me/57${escapar(s.telefono)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <button type="button" class="btn ${esFav ? 'btn-danger' : 'btn-soft'}" data-fav="${s.id}" aria-pressed="${esFav}">${icono('heart')} ${esFav ? 'Quitar de favoritos' : 'Guardar'}</button>
        ${esRestaurante ? `<button type="button" class="btn btn-primary" data-ordenar="${s.id}">${icono('coffee')} Ordenar sin fila</button>` : ''}
      </div>`;
    modalDetalle.abrir();

    if (esRestaurante) {
      try {
        const productos = await api.menu(s.id);
        $('#detalleMenu').innerHTML = `<h3 class="card-title">${icono('coffee')} Menú</h3>` + (productos.length
          ? `<ul class="cart-lines">${productos.map(p => `<li><span>${escapar(p.nombre)}</span><strong>${dinero(p.precio)}</strong></li>`).join('')}</ul>`
          : '<p class="muted small">Este restaurante aún no publicó su menú.</p>');
      } catch { $('#detalleMenu').innerHTML = ''; }
    }
  }

  // ============================================================
  //  GUÍAS TURÍSTICOS
  // ============================================================
  const modalGuia = HC.prepararModal($('#modalGuia'));

  async function cargarGuias() {
    try { guias = await api.guias(); pintarGuias(); }
    catch (e) { $('#listaGuias').innerHTML = `<p class="empty">${escapar(e.message)}</p>`; }
  }

  function fotoGuia(g, clase = 'guide-photo') {
    const src = media(g.fotoUrl);
    return src ? `<img class="${clase}" src="${src}" alt="Foto de ${escapar(g.nombre)}" loading="lazy">`
      : `<span class="${clase}" aria-hidden="true">${escapar(HC.iniciales(g.nombre))}</span>`;
  }

  function pintarGuias() {
    const t = HC.normalizar($('#buscarGuia').value.trim());
    const lista = guias.filter(g => HC.normalizar(`${g.nombre} ${g.especialidad} ${g.idiomas} ${g.municipios}`).includes(t));
    $('#listaGuias').innerHTML = lista.length ? lista.map(g => `<article class="card guide-card">
        <div class="guide-top">${fotoGuia(g)}
          <div><h3 style="font-size:1.15rem">${escapar(g.nombre)}</h3><p class="muted small">${escapar(g.especialidad)}</p>
          <span class="stars" aria-label="Calificación ${Number(g.calificacion).toFixed(1)} de 5">${icono('star')} ${Number(g.calificacion).toFixed(1)}</span></div></div>
        <p class="small">${icono('map')} ${escapar(g.municipios)} · ${g.experienciaAnios} años de experiencia</p>
        <div class="tags">${g.idiomas.split(',').map(i => `<span class="badge badge-info">${escapar(i.trim())}</span>`).join('')}</div>
        <div class="site-foot"><span class="price">${dinero(g.tarifaDia)} <span class="muted small">/ día</span></span>
          <button type="button" class="btn btn-soft btn-sm" data-guia="${g.id}">Ver perfil ${icono('arrow')}</button></div>
      </article>`).join('') : '<p class="empty">No hay guías que coincidan con la búsqueda.</p>';
  }
  $('#buscarGuia').addEventListener('input', pintarGuias);

  function abrirGuia(id) {
    const g = guias.find(x => x.id === Number(id));
    if (!g) return;
    $('#guiaTitulo').textContent = g.nombre;
    $('#guiaContenido').innerHTML = `
      <div class="guide-top">${fotoGuia(g, 'guide-photo')}
        <div><p><strong>${escapar(g.especialidad)}</strong></p>
        <span class="stars">${icono('star')} ${Number(g.calificacion).toFixed(1)} / 5</span></div></div>
      <p style="margin:14px 0">${escapar(g.descripcion)}</p>
      <ul class="info-list">
        <li>${icono('map')}<span><strong>Municipios:</strong> ${escapar(g.municipios)}</span></li>
        <li>${icono('chat')}<span><strong>Idiomas:</strong> ${escapar(g.idiomas)}</span></li>
        <li>${icono('clock')}<span><strong>Experiencia:</strong> ${g.experienciaAnios} años</span></li>
        <li>${icono('card')}<span><strong>Tarifa:</strong> ${dinero(g.tarifaDia)} por día</span></li>
        <li>${icono('shield')}<span><strong>RNT:</strong> ${g.rnt ? escapar(g.rnt) : 'No registrado'}</span></li>
      </ul>
      <div class="modal-actions">
        <a class="btn btn-ghost" href="tel:+57${escapar(g.telefono)}">${icono('phone')} ${escapar(g.telefono)}</a>
        ${g.correo ? `<a class="btn btn-ghost" href="mailto:${escapar(g.correo)}">Correo</a>` : ''}
        <a class="btn btn-green" href="https://wa.me/57${escapar(g.telefono)}?text=${encodeURIComponent('Hola, te encontré en HuilaConecta y quiero información sobre tus recorridos.')}" target="_blank" rel="noopener noreferrer">Escribir por WhatsApp</a>
      </div>`;
    modalGuia.abrir();
  }

  // ============================================================
  //  COMIDA SIN FILA · MENÚ Y CARRITO
  // ============================================================
  let subActiva = 'ordenar';
  function abrirSub(nombre) {
    subActiva = nombre;
    $$('[data-sub]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sub === nombre)));
    $$('[data-subpanel]').forEach(p => { p.hidden = p.dataset.subpanel !== nombre; });
    if (nombre === 'pedidos') cargarMisPedidos();
  }
  $('.sub-tabs').addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (b) abrirSub(b.dataset.sub); });

  const restaurantes = () => catalogo.filter(s => s.categoria === 'Sabores');

  async function prepararCafeteria() {
    if (!catalogo.length) await cargarCatalogo();
    const lista = restaurantes();
    const sel = $('#selRestaurante');
    if (!lista.length) {
      sel.innerHTML = '<option value="">No hay restaurantes disponibles</option>';
      $('#menu').innerHTML = '<p class="empty">Aún no hay restaurantes con pedidos en línea.</p>';
      return;
    }
    sel.innerHTML = lista.map(s => `<option value="${s.id}">${escapar(s.nombre)} · ${escapar(s.municipio)}</option>`).join('');
    if (!restauranteId || !lista.some(s => s.id === restauranteId)) restauranteId = lista[0].id;
    sel.value = restauranteId;
    await cargarMenu();
  }

  $('#selRestaurante').addEventListener('change', async e => {
    if (carrito.size && !await HC.confirmar({ titulo: '¿Cambiar de restaurante?', mensaje: 'Se vaciará tu pedido actual.', aceptar: 'Cambiar', peligro: false })) {
      e.target.value = restauranteId;
      return;
    }
    restauranteId = Number(e.target.value);
    carrito.clear();
    await cargarMenu();
  });

  async function cargarMenu() {
    const s = catalogo.find(x => x.id === restauranteId);
    $('#infoRestaurante').innerHTML = `<div class="card card-pad">
      <h2 class="card-title">${icono('coffee')} ${escapar(s.nombre)}</h2>
      <ul class="info-list" style="margin:0">
        ${s.direccion ? `<li>${icono('map')}<span>${escapar(s.direccion)}</span></li>` : ''}
        ${s.horario ? `<li>${icono('clock')}<span>${escapar(s.horario)}</span></li>` : ''}
      </ul>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:10px" data-detalle="${s.id}">${icono('map')} Ver ubicación en el mapa</button></div>`;
    try {
      menu = await api.menu(restauranteId);
      $('#menu').innerHTML = menu.length ? menu.map(p => {
        const img = media(p.imagenUrl);
        return `<div class="card menu-item">
          ${img ? `<img src="${img}" alt="" loading="lazy">` : '<span class="menu-ph" aria-hidden="true"></span>'}
          <div class="menu-info"><strong>${escapar(p.nombre)}</strong><p class="muted small">${escapar(p.descripcion || '')}</p>
            <p class="price">${dinero(p.precio)}</p></div>
          <div class="qty" role="group" aria-label="Cantidad de ${escapar(p.nombre)}">
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-menos="${p.id}" aria-label="Quitar uno">${icono('minus')}</button>
            <output id="cant-${p.id}" aria-live="polite">${carrito.get(p.id) || 0}</output>
            <button type="button" class="btn btn-soft btn-icon btn-sm" data-mas="${p.id}" aria-label="Agregar uno">${icono('plus')}</button>
          </div></div>`;
      }).join('') : '<p class="empty">Este restaurante aún no tiene productos disponibles.</p>';
      pintarCarrito();
    } catch (e) { $('#menu').innerHTML = `<p class="empty">${escapar(e.message)}</p>`; }
  }

  function totalCarrito() {
    return [...carrito].reduce((t, [id, n]) => t + (menu.find(p => p.id === id)?.precio || 0) * n, 0);
  }
  function lineasCarrito() {
    return [...carrito].map(([id, n]) => {
      const p = menu.find(x => x.id === id);
      return `<li><span>${n} × ${escapar(p.nombre)}</span><span>${dinero(p.precio * n)}</span></li>`;
    }).join('');
  }
  function pintarCarrito() {
    $('#carrito').innerHTML = carrito.size ? lineasCarrito() : '<li class="muted">Agrega productos del menú.</li>';
    $('#carritoTotal').textContent = dinero(totalCarrito());
    $('#btnPagar').disabled = carrito.size === 0;
  }

  $('#menu').addEventListener('click', e => {
    const mas = e.target.closest('[data-mas]');
    const menos = e.target.closest('[data-menos]');
    if (!mas && !menos) return;
    const id = Number((mas || menos).dataset.mas || (mas || menos).dataset.menos);
    const actual = carrito.get(id) || 0;
    const nuevo = Math.max(0, Math.min(20, actual + (mas ? 1 : -1)));
    if (mas && actual >= 20) HC.notificar('Máximo 20 unidades por producto.', 'error');
    nuevo ? carrito.set(id, nuevo) : carrito.delete(id);
    $(`#cant-${id}`).textContent = nuevo;
    pintarCarrito();
  });

  // ============================================================
  //  PASARELA DE PAGO SIMULADA
  // ============================================================
  const modalPago = HC.prepararModal($('#modalPago'));
  const formPago = $('#formPago');
  const fp = formPago.elements;

  function metodoPago() { return formPago.querySelector('input[name="metodo"]:checked').value; }
  function mostrarMetodo() {
    const m = metodoPago();
    $$('[data-metodo]', formPago).forEach(b => { b.hidden = b.dataset.metodo !== m; });
    $('#btnConfirmarPago').textContent = m === 'EFECTIVO' ? 'Confirmar pedido' : `Pagar ${dinero(totalCarrito())}`;
  }
  formPago.addEventListener('change', e => { if (e.target.name === 'metodo') { HC.limpiarErrores(formPago); mostrarMetodo(); } });

  $('#btnPagar').addEventListener('click', () => {
    formPago.reset();
    HC.limpiarErrores(formPago);
    formPago.hidden = false;
    $('#reciboPago').hidden = true;
    $('#pagoTitulo').textContent = 'Pagar pedido';
    $('#resumenPago').innerHTML = lineasCarrito();
    $('#totalPago').textContent = dinero(totalCarrito());
    fp.nequi.value = yo.telefono?.startsWith('3') ? yo.telefono : '';
    mostrarMetodo();
    modalPago.abrir();
    fp.numero.focus();
  });

  formPago.addEventListener('submit', async e => {
    e.preventDefault();
    const m = metodoPago();
    const reglas = [['notas', v => v.length <= 200, 'Máximo 200 caracteres.']];
    if (m === 'TARJETA') reglas.push(
      ['numero', Validar.tarjeta, 'Número de tarjeta inválido (16 dígitos).'],
      ['titular', v => Validar.nombre(v), 'Escribe el nombre del titular (solo letras).'],
      ['vence', Validar.vencimiento, 'Usa el formato MM/AA y una fecha vigente.'],
      ['cvv', Validar.cvv, 'El CVV tiene 3 dígitos.']);
    if (m === 'NEQUI') reglas.push(['nequi', Validar.celularNequi, 'El celular debe tener 10 dígitos y empezar por 3.']);
    if (!HC.validarFormulario(formPago, reglas)) return;

    const datos = {
      sitioId: restauranteId,
      items: [...carrito].map(([productoId, cantidad]) => ({ productoId, cantidad })),
      notas: fp.notas.value.trim() || null,
      recogerEnMinutos: Number(fp.recoger.value),
      pago: m === 'TARJETA'
        ? { metodo: m, numeroTarjeta: fp.numero.value.replace(/\s/g, ''), titular: fp.titular.value.trim(), vencimiento: fp.vence.value, cvv: fp.cvv.value }
        : m === 'NEQUI' ? { metodo: m, telefonoNequi: fp.nequi.value } : { metodo: m }
    };
    try {
      const pedido = await HC.conCarga($('#btnConfirmarPago'), () => api.crearPedido(datos));
      fp.numero.value = ''; fp.cvv.value = '';            // los datos de tarjeta no se conservan
      carrito.clear();
      await cargarMenu();
      mostrarRecibo(pedido);
    } catch (err) {
      HC.alertaFormulario(formPago, err.message);
    }
  });

  function mostrarRecibo(p) {
    formPago.hidden = true;
    $('#pagoTitulo').textContent = p.estadoPago === 'PAGADO' ? '¡Pago aprobado!' : '¡Pedido confirmado!';
    $('#reciboPago').hidden = false;
    $('#reciboPago').innerHTML = `<div class="receipt">
      <span class="badge badge-ok">${p.estadoPago === 'PAGADO' ? 'Pagado' : 'Pagas al recoger'}</span>
      <p class="muted">Muestra este código en ${escapar(p.sitioNombre)}:</p>
      <p class="order-code">${escapar(p.codigo)}</p>
      <p>Recoge a las <strong>${hora(p.recogerEn)}</strong> · Total <strong>${dinero(p.total)}</strong></p>
      ${p.referenciaPago ? `<p class="muted small">Referencia: ${escapar(p.referenciaPago)}${p.ultimos4 ? ` · ${escapar(p.marcaTarjeta)} ··${escapar(p.ultimos4)}` : ''}</p>` : ''}
      <div class="modal-actions" style="justify-content:center">
        <button type="button" class="btn btn-primary" data-ver-pedidos>Ver mis pedidos</button></div></div>`;
    $('[data-ver-pedidos]').addEventListener('click', () => { modalPago.cerrar(); abrirSub('pedidos'); });
  }

  // ============================================================
  //  MIS PEDIDOS (se actualiza cada 15 s mientras está visible)
  // ============================================================
  const ESTADO_PEDIDO = {
    PENDIENTE: ['Recibido', 'badge-warn'], EN_PREPARACION: ['En preparación', 'badge-info'],
    LISTO: ['¡Listo para recoger!', 'badge-ok'], ENTREGADO: ['Entregado', 'badge-ok'], CANCELADO: ['Cancelado', 'badge-bad']
  };
  const PAGO = { PAGADO: 'Pagado', PENDIENTE: 'Pagas al recoger', REEMBOLSADO: 'Reembolsado' };

  async function cargarMisPedidos() {
    try {
      misPedidos = await api.misPedidos();
      const activos = misPedidos.filter(p => ['PENDIENTE', 'EN_PREPARACION', 'LISTO'].includes(p.estado)).length;
      $('#contadorPedidos').textContent = activos;
      $('#contadorPedidos').hidden = activos === 0;
      $('#listaPedidos').innerHTML = misPedidos.length ? misPedidos.map(p => {
        const [estado, clase] = ESTADO_PEDIDO[p.estado];
        return `<article class="card order">
          <div class="order-head"><div><p class="order-code">${escapar(p.codigo)}</p>
            <p class="muted small">${escapar(p.sitioNombre)} · ${haceCuanto(p.fecha)}</p></div>
            <span class="badge ${clase}">${estado}</span></div>
          <ul class="order-items">${p.items.map(i => `<li><span>${i.cantidad} × ${escapar(i.nombreProducto)}</span><span>${dinero(i.subtotal)}</span></li>`).join('')}</ul>
          <p class="small"><strong>${dinero(p.total)}</strong> · ${PAGO[p.estadoPago]}${p.estado !== 'CANCELADO' && p.estado !== 'ENTREGADO' ? ` · ${icono('clock')} recoger a las ${hora(p.recogerEn)}` : ''}</p>
          ${p.estado === 'PENDIENTE' ? `<div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-cancelar="${p.id}">Cancelar pedido</button></div>` : ''}
        </article>`;
      }).join('') : '<div class="empty"><p>Aún no has hecho pedidos.</p><button type="button" class="btn btn-primary" data-sub-ir="ordenar" style="margin-top:12px">Ordenar ahora</button></div>';
    } catch (e) { HC.notificar(e.message, 'error'); }
  }

  $('#listaPedidos').addEventListener('click', async e => {
    if (e.target.closest('[data-sub-ir]')) { abrirSub('ordenar'); return; }
    const b = e.target.closest('[data-cancelar]');
    if (!b) return;
    if (!await HC.confirmar({ titulo: '¿Cancelar el pedido?', mensaje: 'Si ya lo pagaste, el valor se reembolsa.', aceptar: 'Cancelar pedido' })) return;
    try { await api.cancelarPedido(b.dataset.cancelar); HC.notificar('Pedido cancelado.', 'ok'); await cargarMisPedidos(); }
    catch (err) { HC.notificar(err.message, 'error'); }
  });

  function vigilarPedidos(activo) {
    clearInterval(sondeoPedidos);
    sondeoPedidos = activo ? setInterval(() => { if (!document.hidden && subActiva === 'pedidos') cargarMisPedidos(); }, 15000) : null;
  }

  // ============================================================
  //  PERFIL · GALERÍA PERSONAL
  // ============================================================
  const formFoto = $('#formFoto');
  let selectorGaleria = null;
  let fotos = [];

  async function cargarGaleria() {
    try {
      fotos = await api.fotos();
      $('#totalFotos').textContent = `${fotos.length} foto(s)`;
      $('#galeria').innerHTML = fotos.length ? fotos.map(f => `<figure class="photo">
          <img src="${media(f.url)}" alt="${escapar(f.descripcion || 'Foto de viaje')}" loading="lazy">
          <figcaption><span>${escapar(f.descripcion || 'Sin descripción')}</span>
            <span style="display:flex;gap:4px">
              <button type="button" class="btn btn-icon btn-sm" data-editar-foto="${f.id}" aria-label="Editar descripción">${icono('edit')}</button>
              <button type="button" class="btn btn-icon btn-sm" data-eliminar-foto="${f.id}" aria-label="Eliminar foto">${icono('trash')}</button>
            </span></figcaption></figure>`).join('')
        : '<p class="empty" style="grid-column:1/-1">Aún no tienes fotos. ¡Sube tu primer recuerdo del Huila!</p>';
    } catch (e) { HC.notificar(e.message, 'error'); }
  }

  formFoto.addEventListener('submit', async e => {
    e.preventDefault();
    HC.limpiarErrores(formFoto);
    if (!selectorGaleria.valido()) return;
    try {
      await HC.conCarga(formFoto.querySelector('[type="submit"]'), () => api.agregarFoto(selectorGaleria.valor(), formFoto.elements.descripcion.value.trim() || null));
      formFoto.reset();
      selectorGaleria.establecer('');
      HC.notificar('Foto agregada a tu galería.', 'ok');
      await cargarGaleria();
    } catch (err) { HC.alertaFormulario(formFoto, err.message); }
  });

  $('#galeria').addEventListener('click', async e => {
    const editar = e.target.closest('[data-editar-foto]');
    const eliminar = e.target.closest('[data-eliminar-foto]');
    try {
      if (editar) {
        const f = fotos.find(x => String(x.id) === editar.dataset.editarFoto);
        const texto = await HC.pedirTexto({ titulo: 'Editar descripción', etiqueta: 'Descripción', minimo: 1, maximo: 200, aceptar: 'Guardar' });
        if (texto === null) return;
        await api.editarFoto(f.id, texto);
        await cargarGaleria();
      }
      if (eliminar) {
        if (!await HC.confirmar({ titulo: '¿Eliminar esta foto?', aceptar: 'Eliminar' })) return;
        await api.eliminarFoto(eliminar.dataset.eliminarFoto);
        await cargarGaleria();
      }
    } catch (err) { HC.notificar(err.message, 'error'); }
  });

  // ---------- Eliminar cuenta (confirma con contraseña) ----------
  $('#btnEliminarCuenta').addEventListener('click', () => {
    const d = document.createElement('dialog');
    d.className = 'modal modal-sm';
    d.innerHTML = `<form class="modal-body form" novalidate><h2 style="font-size:1.3rem">¿Eliminar tu cuenta?</h2>
      <p class="muted">Esta acción no se puede deshacer. Escribe tu contraseña para confirmar.</p>
      <div class="field"><label for="pwEliminar">Contraseña <span class="req">*</span></label>
        <input class="input" id="pwEliminar" name="password" type="password" maxlength="64" autocomplete="current-password">
        <p class="field-error" hidden></p></div>
      <p class="form-alert" role="alert" tabindex="-1" hidden></p>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-cancelar>Cancelar</button>
        <button type="submit" class="btn btn-danger">Eliminar definitivamente</button></div></form>`;
    document.body.appendChild(d);
    const f = d.querySelector('form');
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (!HC.validarFormulario(f, [['password', v => v !== '', 'Escribe tu contraseña.']])) return;
      try {
        await HC.conCarga(f.querySelector('[type="submit"]'), () => api.eliminarCuenta(f.elements.password.value));
        location.href = 'index.html';
      } catch (err) { HC.alertaFormulario(f, err.message); }
    });
    d.querySelector('[data-cancelar]').addEventListener('click', () => d.close());
    d.addEventListener('close', () => d.remove());
    d.showModal();
    f.elements.password.focus();
  });

  // ============================================================
  //  DELEGACIÓN GLOBAL Y PESTAÑAS
  // ============================================================
  document.addEventListener('click', async e => {
    const fav = e.target.closest('[data-fav]');
    const detalle = e.target.closest('[data-detalle]');
    const guia = e.target.closest('[data-guia]');
    const ordenar = e.target.closest('[data-ordenar]');
    const ir = e.target.closest('[data-ir]');
    if (fav) {
      const enModal = Boolean(fav.closest('dialog'));
      await alternarFavorito(fav);
      if (enModal) abrirDetalle(fav.dataset.fav);
    }
    if (detalle) abrirDetalle(detalle.dataset.detalle);
    if (guia) abrirGuia(guia.dataset.guia);
    if (ordenar) {
      modalDetalle.cerrar();
      restauranteId = Number(ordenar.dataset.ordenar);
      carrito.clear();
      tabs.abrir('cafeteria');
      abrirSub('ordenar');
    }
    if (ir) tabs.abrir(ir.dataset.ir, true);
  });

  tabs = HC.pestanas($('.app-tabs'), async nombre => {
    vigilarPedidos(nombre === 'cafeteria');
    if (nombre === 'explorar') cargarCatalogo();
    if (nombre === 'guias') cargarGuias();
    if (nombre === 'cafeteria') { await prepararCafeteria(); if (subActiva === 'pedidos') cargarMisPedidos(); }
    if (nombre === 'comunidad' && !comunidadIniciada) { comunidadIniciada = true; HC.comunidad($('#comunidad'), { usuario: yo, puedePublicar: false }); }
    if (nombre === 'favoritos') { await cargarCatalogo(); pintarFavoritos(); }
    if (nombre === 'perfil') {
      if (!selectorGaleria) {
        selectorGaleria = HC.selectorImagen($('#selectorGaleria'), { etiqueta: 'Nueva foto', opcional: false });
        HC.cuenta($('#cuenta'), yo, u => { $('#saludo').textContent = `¡Hola, ${u.nombre.split(' ')[0]}! 👋`; });
      }
      cargarGaleria();
    }
  });
})();
