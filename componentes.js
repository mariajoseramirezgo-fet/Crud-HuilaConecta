/* ==============================================================
   HuilaConecta · componentes.js
   Componentes de interfaz reutilizados por los paneles:
   1. HC.selectorImagen → imagen por URL o subida desde el PC.
   2. HC.comunidad      → muro con publicaciones, comentarios y "Me gusta".
   3. HC.cuenta         → foto de perfil, datos personales y contraseña.
   Todo se guarda en MySQL a través de la API (sin almacenamiento local).
   ============================================================== */
'use strict';

(() => {
  const { $, $$, api, Validar, escapar, media, avatar, icono, haceCuanto } = HC;
  let contador = 0;
  const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_BYTES = 2 * 1024 * 1024;

  // ============================================================
  //  1. SELECTOR DE IMAGEN: URL externa o archivo desde el PC
  // ============================================================
  /**
   * Pinta dentro de `contenedor` un selector con dos modos:
   *  - "Subir desde mi PC": valida tipo y tamaño (≤ 2 MB), sube a POST /api/archivos y
   *    guarda la ruta /api/archivos/{id} que devuelve el servidor.
   *  - "Usar un enlace": acepta una URL http(s).
   * Devuelve { valor(), establecer(url), ocupado() }.
   */
  HC.selectorImagen = function (contenedor, { etiqueta = 'Imagen', opcional = true } = {}) {
    const id = 'img' + (++contador);
    let valor = '';
    let subiendo = false;

    contenedor.classList.add('field', 'img-picker');
    contenedor.innerHTML = `
      <span class="label" id="${id}-lbl">${escapar(etiqueta)}${opcional ? ' <span class="muted small">(opcional)</span>' : ' <span class="req">*</span>'}</span>
      <div class="seg" role="radiogroup" aria-labelledby="${id}-lbl">
        <label><input type="radio" name="${id}-modo" value="archivo" checked><span>${icono('upload')} Subir desde mi PC</span></label>
        <label><input type="radio" name="${id}-modo" value="url"><span>${icono('link')} Usar un enlace</span></label>
      </div>
      <div class="img-picker-body">
        <div class="img-preview" aria-hidden="true">${icono('image')}</div>
        <div class="img-inputs">
          <div data-modo="archivo">
            <label class="btn btn-soft btn-sm file-btn">${icono('camera')} Elegir imagen
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="sr-only" id="${id}-file"></label>
            <p class="field-hint">JPG, PNG, WEBP o GIF · máximo 2 MB.</p>
          </div>
          <div data-modo="url" hidden>
            <label class="sr-only" for="${id}-url">Enlace de la imagen</label>
            <input class="input" type="url" id="${id}-url" maxlength="490" placeholder="https://…">
          </div>
          <p class="img-estado small" aria-live="polite"></p>
          <button type="button" class="btn btn-ghost btn-sm" data-quitar hidden>${icono('trash')} Quitar imagen</button>
        </div>
      </div>
      <p class="field-error" hidden></p>`;

    const vista = $('.img-preview', contenedor);
    const estado = $('.img-estado', contenedor);
    const inputUrl = $(`#${id}-url`, contenedor);
    const inputArchivo = $(`#${id}-file`, contenedor);
    const quitar = $('[data-quitar]', contenedor);
    const error = $('.field-error', contenedor);

    function mostrarError(msg) { error.textContent = msg; error.hidden = !msg; }
    function pintar() {
      const src = media(valor);
      vista.innerHTML = src ? `<img src="${src}" alt="Vista previa">` : icono('image');
      quitar.hidden = !valor;
    }
    function modo(m) {
      $$('[data-modo]', contenedor).forEach(b => { b.hidden = b.dataset.modo !== m; });
      $(`input[value="${m}"]`, contenedor).checked = true;
    }

    contenedor.addEventListener('change', e => { if (e.target.name === `${id}-modo`) modo(e.target.value); });

    // Subida inmediata al elegir el archivo
    inputArchivo.addEventListener('change', async () => {
      const archivo = inputArchivo.files[0];
      inputArchivo.value = '';
      if (!archivo) return;
      mostrarError('');
      if (!TIPOS_IMAGEN.includes(archivo.type)) return mostrarError('Formato no permitido. Usa JPG, PNG, WEBP o GIF.');
      if (archivo.size > MAX_BYTES) return mostrarError('La imagen supera 2 MB. Redúcela e inténtalo de nuevo.');
      subiendo = true;
      estado.textContent = `Subiendo "${archivo.name}"…`;
      try {
        const r = await api.subirArchivo(archivo);
        valor = r.url;
        inputUrl.value = '';
        estado.textContent = 'Imagen subida y guardada en el servidor ✓';
        pintar();
      } catch (e) {
        estado.textContent = '';
        mostrarError(e.message);
      } finally { subiendo = false; }
    });

    // URL: se valida al escribir
    inputUrl.addEventListener('input', () => {
      const v = inputUrl.value.trim();
      mostrarError('');
      if (!v) { valor = ''; pintar(); return; }
      if (!/^https?:\/\/\S{4,}$/.test(v)) { mostrarError('El enlace debe empezar por http:// o https://'); return; }
      valor = v;
      estado.textContent = '';
      pintar();
    });

    quitar.addEventListener('click', () => { valor = ''; inputUrl.value = ''; estado.textContent = ''; pintar(); });

    return {
      valor: () => valor || null,
      /** Carga un valor existente al editar. */
      establecer(url) {
        valor = url || '';
        mostrarError('');
        estado.textContent = '';
        if (/^https?:\/\//.test(valor)) { modo('url'); inputUrl.value = valor; }
        else { modo('archivo'); inputUrl.value = ''; }
        pintar();
      },
      /** true si hay un error o una subida en curso. */
      ocupado: () => subiendo,
      valido() {
        if (subiendo) { mostrarError('Espera a que termine de subir la imagen.'); return false; }
        if (!opcional && !valor) { mostrarError('Selecciona una imagen.'); return false; }
        if (!error.hidden) return false;
        return Validar.imagen(valor);
      }
    };
  };

  // ============================================================
  //  2. COMUNIDAD: muro, publicar, comentar y "Me gusta"
  // ============================================================
  /**
   * @param {HTMLElement} raiz
   * @param {{usuario: object, puedePublicar: boolean}} opciones
   */
  HC.comunidad = function (raiz, { usuario, puedePublicar = false }) {
    let publicaciones = [];
    let vista = 'muro'; // 'muro' | 'mias'
    let selector = null;
    let editandoId = null;

    raiz.innerHTML = `
      ${puedePublicar ? `
      <form class="card card-pad form composer" novalidate>
        <div class="composer-head">${avatar(usuario)}<div><strong>Comparte con la comunidad</strong>
          <p class="muted small">Novedades, promociones o consejos para los viajeros.</p></div></div>
        <div class="field">
          <label class="sr-only" for="comContenido">Contenido de la publicación</label>
          <textarea class="textarea" id="comContenido" name="contenido" maxlength="1000" placeholder="¿Qué quieres contar hoy?" required></textarea>
          <p class="field-hint"><span data-contador>0</span>/1000</p>
          <p class="field-error" hidden></p>
        </div>
        <div data-selector></div>
        <p class="form-alert" role="alert" tabindex="-1" hidden></p>
        <div class="row-actions" style="justify-content:flex-end">
          <button type="button" class="btn btn-ghost" data-cancelar-edicion hidden>Cancelar edición</button>
          <button type="submit" class="btn btn-primary">${icono('chat')} Publicar</button>
        </div>
      </form>
      <div class="chip-row" role="group" aria-label="Qué publicaciones ver">
        <button type="button" class="chip" data-vista="muro" aria-pressed="true">Muro de la comunidad</button>
        <button type="button" class="chip" data-vista="mias" aria-pressed="false">Mis publicaciones</button>
      </div>` : ''}
      <div class="feed" aria-live="polite"><p class="empty">Cargando publicaciones…</p></div>`;

    const feed = $('.feed', raiz);
    const form = $('form.composer', raiz);
    if (form) {
      selector = HC.selectorImagen($('[data-selector]', form), { etiqueta: 'Imagen de la publicación' });
      form.elements.contenido.addEventListener('input', () => { $('[data-contador]', form).textContent = form.elements.contenido.value.length; });
      form.addEventListener('submit', publicar);
      $('[data-cancelar-edicion]', form).addEventListener('click', terminarEdicion);
    }

    async function cargar() {
      try {
        publicaciones = vista === 'mias' ? await api.misPublicaciones() : await api.muro();
        pintar();
      } catch (e) {
        feed.innerHTML = `<p class="empty">${escapar(e.message)}</p>`;
      }
    }

    function pintar() {
      $$('[data-vista]', raiz).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vista === vista)));
      feed.innerHTML = publicaciones.length ? publicaciones.map(tarjeta).join('')
        : `<p class="empty">${vista === 'mias' ? 'Aún no has publicado nada.' : 'Todavía no hay publicaciones. ¡Vuelve pronto!'}</p>`;
    }

    function tarjeta(p) {
      const img = media(p.imagenUrl);
      const rolTexto = { EMPRENDEDOR: 'Emprendedor', TURISTA: 'Turista', ADMIN: 'Equipo HuilaConecta' }[p.autor.rol] || '';
      return `<article class="card post" data-post="${p.id}">
        <header class="post-head">${avatar(p.autor)}
          <div><strong>${escapar(p.autor.nombre)}</strong>
          <p class="muted small">${rolTexto} · ${haceCuanto(p.fecha)}${p.fechaEdicion ? ' · editado' : ''}</p></div>
          ${p.esMia ? `<div class="post-tools">
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-editar-post="${p.id}" aria-label="Editar publicación">${icono('edit')}</button>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-eliminar-post="${p.id}" aria-label="Eliminar publicación">${icono('trash')}</button></div>` : ''}
        </header>
        ${p.estado === 'OCULTA' ? `<p class="note note-bad"><strong>Oculta por moderación:</strong> ${escapar(p.motivoModeracion || '')}</p>` : ''}
        <p class="post-text">${escapar(p.contenido)}</p>
        ${img ? `<img class="post-img" src="${img}" alt="Imagen de la publicación" loading="lazy">` : ''}
        <div class="post-bar">
          <button type="button" class="like-btn" data-like="${p.id}" aria-pressed="${p.meGusta}" ${p.estado === 'OCULTA' ? 'disabled' : ''}
            aria-label="${p.meGusta ? 'Quitar Me gusta' : 'Me gusta'}">${icono('heart')} <span>${p.totalLikes}</span></button>
          <span class="muted small">${icono('chat')} ${p.totalComentarios} comentario(s)</span>
        </div>
        <ul class="comments">${p.comentarios.map(c => comentario(c, p)).join('')}</ul>
        ${p.estado === 'VISIBLE' ? `<form class="comment-form" data-comentar="${p.id}" novalidate>
          ${avatar(usuario, 'avatar-sm')}
          <div class="field" style="flex:1">
            <label class="sr-only" for="com-${p.id}">Escribe un comentario</label>
            <input class="input" id="com-${p.id}" name="contenido" maxlength="500" placeholder="Escribe un comentario…" autocomplete="off">
            <p class="field-error" hidden></p>
          </div>
          <button type="submit" class="btn btn-green btn-sm">Comentar</button>
        </form>` : ''}
      </article>`;
    }

    function comentario(c, p) {
      const puedeBorrar = c.esMio || p.esMia;
      return `<li class="comment">${avatar(c.autor, 'avatar-sm')}
        <div class="comment-body"><p><strong>${escapar(c.autor.nombre)}</strong> <span class="muted small">${haceCuanto(c.fecha)}</span></p>
        <p>${escapar(c.contenido)}</p></div>
        ${puedeBorrar ? `<button type="button" class="btn btn-ghost btn-icon btn-sm" data-eliminar-comentario="${c.id}" aria-label="Eliminar comentario">${icono('trash')}</button>` : ''}
      </li>`;
    }

    /** Publica o guarda la edición. */
    async function publicar(e) {
      e.preventDefault();
      const ok = HC.validarFormulario(form, [
        ['contenido', v => v.trim().length >= 3, 'Escribe al menos 3 caracteres.']
      ]);
      if (!ok || !selector.valido()) return;
      const datos = { contenido: form.elements.contenido.value.trim(), imagenUrl: selector.valor() };
      try {
        await HC.conCarga(form.querySelector('[type="submit"]'), () =>
          editandoId ? api.editarPublicacion(editandoId, datos) : api.publicar(datos));
        HC.notificar(editandoId ? 'Publicación actualizada.' : '¡Publicado en la comunidad!', 'ok');
        terminarEdicion();
        await cargar();
      } catch (err) { HC.alertaFormulario(form, err.message); }
    }

    function terminarEdicion() {
      editandoId = null;
      form.reset();
      selector.establecer('');
      $('[data-contador]', form).textContent = '0';
      $('[data-cancelar-edicion]', form).hidden = true;
      form.querySelector('[type="submit"]').innerHTML = `${icono('chat')} Publicar`;
      HC.limpiarErrores(form);
    }

    // Delegación de eventos del muro
    raiz.addEventListener('click', async e => {
      const t = e.target;
      const cambiarVista = t.closest('[data-vista]');
      const like = t.closest('[data-like]');
      const editar = t.closest('[data-editar-post]');
      const borrarPost = t.closest('[data-eliminar-post]');
      const borrarCom = t.closest('[data-eliminar-comentario]');

      if (cambiarVista) { vista = cambiarVista.dataset.vista; await cargar(); }

      if (like) {
        const p = publicaciones.find(x => String(x.id) === like.dataset.like);
        like.disabled = true;
        try {
          const r = p.meGusta ? await api.quitarLike(p.id) : await api.darLike(p.id);
          p.meGusta = r.meGusta; p.totalLikes = r.totalLikes;
          like.setAttribute('aria-pressed', String(r.meGusta));
          like.setAttribute('aria-label', r.meGusta ? 'Quitar Me gusta' : 'Me gusta');
          like.querySelector('span').textContent = r.totalLikes;
        } catch (err) { HC.notificar(err.message, 'error'); }
        finally { like.disabled = false; }
      }

      if (editar) {
        const p = publicaciones.find(x => String(x.id) === editar.dataset.editarPost);
        editandoId = p.id;
        form.elements.contenido.value = p.contenido;
        $('[data-contador]', form).textContent = p.contenido.length;
        selector.establecer(p.imagenUrl);
        $('[data-cancelar-edicion]', form).hidden = false;
        form.querySelector('[type="submit"]').innerHTML = `${icono('check')} Guardar cambios`;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        form.elements.contenido.focus();
      }

      if (borrarPost) {
        if (!await HC.confirmar({ titulo: '¿Eliminar la publicación?', mensaje: 'Se borrarán también sus comentarios y "Me gusta".', aceptar: 'Eliminar' })) return;
        try { await api.eliminarPublicacion(borrarPost.dataset.eliminarPost); HC.notificar('Publicación eliminada.', 'ok'); await cargar(); }
        catch (err) { HC.notificar(err.message, 'error'); }
      }

      if (borrarCom) {
        if (!await HC.confirmar({ titulo: '¿Eliminar el comentario?', aceptar: 'Eliminar' })) return;
        try { await api.eliminarComentario(borrarCom.dataset.eliminarComentario); await cargar(); }
        catch (err) { HC.notificar(err.message, 'error'); }
      }
    });

    // Enviar comentario
    raiz.addEventListener('submit', async e => {
      const f = e.target.closest('[data-comentar]');
      if (!f) return;
      e.preventDefault();
      const ok = HC.validarFormulario(f, [
        ['contenido', v => v.trim().length >= 1, 'Escribe tu comentario.'],
        ['contenido', v => v.trim().length <= 500, 'Máximo 500 caracteres.']
      ]);
      if (!ok) return;
      try {
        await HC.conCarga(f.querySelector('[type="submit"]'), () => api.comentar(f.dataset.comentar, f.elements.contenido.value.trim()));
        const id = f.dataset.comentar;
        await cargar();
        $(`#com-${id}`, raiz)?.focus();
      } catch (err) { HC.notificar(err.message, 'error'); }
    });

    cargar();
    return { recargar: cargar };
  };

  // ============================================================
  //  3. CUENTA: foto de perfil, datos personales y contraseña
  // ============================================================
  /**
   * @param {HTMLElement} raiz
   * @param {object} usuario      usuario actual (GET /api/auth/me)
   * @param {Function} alGuardar  recibe el usuario actualizado
   */
  HC.cuenta = function (raiz, usuario, alGuardar) {
    raiz.innerHTML = `
      <div class="card card-pad">
        <h2 class="card-title">${icono('camera')} Foto de perfil</h2>
        <div class="profile-photo">
          <div data-avatar-grande>${avatar(usuario, 'avatar-xl')}</div>
          <form class="form" data-form-foto novalidate style="flex:1;min-width:0">
            <div data-selector-foto></div>
            <p class="form-alert" role="alert" tabindex="-1" hidden></p>
            <div class="row-actions"><button type="submit" class="btn btn-green">Guardar foto</button>
              <button type="button" class="btn btn-ghost" data-quitar-foto>Quitar foto</button></div>
          </form>
        </div>
      </div>

      <div class="card card-pad">
        <h2 class="card-title">${icono('user')} Datos personales</h2>
        <form class="form" data-form-datos novalidate>
          <div class="form-grid cols-2">
            <div class="field span-2"><label for="ctaNombre">Nombre completo <span class="req">*</span></label>
              <input class="input" id="ctaNombre" name="nombre" maxlength="80" data-solo-letras autocomplete="name" required>
              <p class="field-error" hidden></p></div>
            <div class="field"><label for="ctaCorreo">Correo <span class="req">*</span></label>
              <input class="input" id="ctaCorreo" name="correo" type="email" maxlength="120" autocomplete="email" required>
              <p class="field-error" hidden></p></div>
            <div class="field"><label for="ctaTelefono">Celular <span class="req">*</span></label>
              <input class="input" id="ctaTelefono" name="telefono" type="tel" inputmode="numeric" maxlength="10" data-solo-numeros autocomplete="tel-national" required>
              <p class="field-hint">Solo números · 10 dígitos.</p><p class="field-error" hidden></p></div>
          </div>
          <p class="form-alert" role="alert" tabindex="-1" hidden></p>
          <div><button type="submit" class="btn btn-green">Guardar cambios</button></div>
        </form>
      </div>

      <div class="card card-pad">
        <h2 class="card-title">${icono('shield')} Cambiar contraseña</h2>
        <p class="muted small" style="margin:-6px 0 12px">Se guarda cifrada (BCrypt). Al cambiarla se cierran tus sesiones en otros dispositivos.</p>
        <form class="form" data-form-password novalidate>
          <div class="form-grid cols-2">
            <div class="field span-2"><label for="ctaActual">Contraseña actual <span class="req">*</span></label>
              <input class="input" id="ctaActual" name="actual" type="password" maxlength="64" autocomplete="current-password" required>
              <p class="field-error" hidden></p></div>
            <div class="field"><label for="ctaNueva">Nueva contraseña <span class="req">*</span></label>
              <input class="input" id="ctaNueva" name="nueva" type="password" maxlength="64" autocomplete="new-password" aria-describedby="ctaReglas" required>
              <p class="field-error" hidden></p></div>
            <div class="field"><label for="ctaConfirmar">Confirmar nueva contraseña <span class="req">*</span></label>
              <input class="input" id="ctaConfirmar" name="confirmar" type="password" maxlength="64" autocomplete="new-password" required>
              <p class="field-error" hidden></p></div>
            <ul class="pw-rules span-2" id="ctaReglas" aria-live="polite"></ul>
          </div>
          <label class="check"><input type="checkbox" data-mostrar="ctaActual,ctaNueva,ctaConfirmar"> Mostrar contraseñas</label>
          <p class="form-alert" role="alert" tabindex="-1" hidden></p>
          <div><button type="submit" class="btn btn-green">Actualizar contraseña</button></div>
        </form>
      </div>`;

    const formFoto = $('[data-form-foto]', raiz);
    const formDatos = $('[data-form-datos]', raiz);
    const formPw = $('[data-form-password]', raiz);
    const selector = HC.selectorImagen($('[data-selector-foto]', raiz), { etiqueta: 'Nueva foto', opcional: false });
    selector.establecer(usuario.fotoUrl);

    function refrescar(u) {
      usuario = u;
      $('[data-avatar-grande]', raiz).innerHTML = avatar(u, 'avatar-xl');
      HC.pintarUsuarioEncabezado(u);
      alGuardar?.(u);
    }

    // ---- Foto ----
    formFoto.addEventListener('submit', async e => {
      e.preventDefault();
      HC.limpiarErrores(formFoto);
      if (!selector.valido()) return;
      try {
        const u = await HC.conCarga(formFoto.querySelector('[type="submit"]'), () => api.actualizarFoto(selector.valor()));
        refrescar(u);
        HC.notificar('Foto de perfil actualizada.', 'ok');
      } catch (err) { HC.alertaFormulario(formFoto, err.message); }
    });
    $('[data-quitar-foto]', raiz).addEventListener('click', async () => {
      try {
        const u = await api.actualizarFoto(null);
        selector.establecer('');
        refrescar(u);
        HC.notificar('Se quitó la foto de perfil.', 'ok');
      } catch (err) { HC.notificar(err.message, 'error'); }
    });

    // ---- Datos ----
    const f = formDatos.elements;
    f.nombre.value = usuario.nombre; f.correo.value = usuario.correo; f.telefono.value = usuario.telefono;
    formDatos.addEventListener('submit', async e => {
      e.preventDefault();
      const ok = HC.validarFormulario(formDatos, [
        ['nombre', Validar.nombre, 'El nombre solo admite letras (3 a 80 caracteres).'],
        ['correo', Validar.correo, 'Escribe un correo válido.'],
        ['telefono', Validar.telefono, 'El celular debe tener exactamente 10 dígitos.']
      ]);
      if (!ok) return;
      try {
        const u = await HC.conCarga(formDatos.querySelector('[type="submit"]'), () =>
          api.actualizarPerfil({ nombre: f.nombre.value.trim(), correo: f.correo.value.trim().toLowerCase(), telefono: f.telefono.value }));
        refrescar(u);
        HC.notificar('Datos actualizados.', 'ok');
      } catch (err) {
        if (err.status === 409) HC.marcarError(f.correo, err.message);
        HC.alertaFormulario(formDatos, err.message);
      }
    });

    // ---- Contraseña ----
    const p = formPw.elements;
    const reglas = () => HC.pintarReglasPassword($('#ctaReglas', raiz), p.nueva.value);
    p.nueva.addEventListener('input', reglas);
    reglas();
    formPw.addEventListener('submit', async e => {
      e.preventDefault();
      const ok = HC.validarFormulario(formPw, [
        ['actual', v => v !== '', 'Escribe tu contraseña actual.'],
        ['nueva', Validar.password, 'La nueva contraseña no cumple todas las reglas.'],
        ['nueva', v => v !== p.actual.value, 'La nueva contraseña debe ser diferente a la actual.'],
        ['confirmar', v => v === p.nueva.value, 'La confirmación no coincide.']
      ]);
      if (!ok) return;
      try {
        const r = await HC.conCarga(formPw.querySelector('[type="submit"]'), () => api.cambiarPassword(p.actual.value, p.nueva.value));
        formPw.reset();
        ['actual', 'nueva', 'confirmar'].forEach(n => { p[n].type = 'password'; });
        reglas();
        HC.notificar(r.mensaje || 'Contraseña actualizada.', 'ok');
      } catch (err) {
        if (err.status === 401) HC.marcarError(p.actual, err.message);
        HC.alertaFormulario(formPw, err.message);
      }
    });
  };
})();
