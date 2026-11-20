/**
 * Comunidad: muro de publicaciones con comentarios y "Me gusta".
 *  - EMPRENDEDOR: publica, edita y elimina sus publicaciones.
 *  - Todos los roles con sesión: leen, comentan y dan "Me gusta".
 *  - ADMIN: moderación (ocultar / restaurar / eliminar publicaciones y comentarios).
 * Base: /api/comunidad
 */
'use strict';
const express = require('express');
const { consulta, uno } = require('../db');
const { conSesion, rol } = require('../middleware/sesion');
const { ApiError } = require('../utils/errores');
const v = require('../utils/validaciones');
const { fecha } = require('../utils/mapeos');

const router = express.Router();
router.use(conSesion); // toda la comunidad exige sesión

const ESTADOS = ['VISIBLE', 'OCULTA'];
// Del autor solo se exponen id, nombre, rol y foto (nunca correo ni teléfono)
const AUTOR = 'u.nombre AS autor_nombre, u.rol AS autor_rol, u.foto_url AS autor_foto';
const PUB_SELECT = `SELECT p.*, ${AUTOR} FROM publicaciones p JOIN usuarios u ON u.id = p.autor_id`;
const COM_SELECT = `SELECT c.*, ${AUTOR} FROM comentarios c JOIN usuarios u ON u.id = c.autor_id`;

// =====================================================================
//  Conversión a los objetos que recibe el frontend
// =====================================================================
const autor = f => ({ id: f.autor_id, nombre: f.autor_nombre, rol: f.autor_rol, fotoUrl: f.autor_foto });

const comentarioDTO = (c, yo) => ({
  id: c.id,
  publicacionId: c.publicacion_id,
  autor: autor(c),
  contenido: c.contenido,
  estado: c.estado,
  fecha: fecha(c.fecha),
  esMio: c.autor_id === yo.id
});

/**
 * Arma las publicaciones con sus comentarios y "Me gusta" en solo 3 consultas.
 * @param incluirOcultos true en moderación: muestra también los comentarios ocultos.
 */
async function armar(publicaciones, yo, incluirOcultos) {
  if (publicaciones.length === 0) return [];
  const ids = publicaciones.map(p => p.id);
  const comentarios = await consulta(
    `${COM_SELECT} WHERE c.publicacion_id IN (?) ${incluirOcultos ? '' : "AND c.estado = 'VISIBLE'"}
     ORDER BY c.fecha ASC, c.id ASC`, [ids]);
  const likes = await consulta(
    `SELECT publicacion_id, COUNT(*) AS total, SUM(usuario_id = ?) AS mio
     FROM publicacion_likes WHERE publicacion_id IN (?) GROUP BY publicacion_id`, [yo.id, ids]);

  return publicaciones.map(p => {
    const lista = comentarios.filter(c => c.publicacion_id === p.id).map(c => comentarioDTO(c, yo));
    const like = likes.find(l => l.publicacion_id === p.id);
    return {
      id: p.id,
      autor: autor(p),
      contenido: p.contenido,
      imagenUrl: p.imagen_url,
      estado: p.estado,
      motivoModeracion: p.motivo_moderacion,
      fecha: fecha(p.fecha),
      fechaEdicion: fecha(p.fecha_edicion),
      totalLikes: like ? like.total : 0,
      meGusta: Boolean(like && like.mio > 0),
      totalComentarios: lista.length,
      comentarios: lista,
      esMia: p.autor_id === yo.id
    };
  });
}

const armarUna = async (id, yo, incluirOcultos) =>
  (await armar([await buscarPublicacion(id)], yo, incluirOcultos))[0];

async function buscarPublicacion(id) {
  const p = await uno(`${PUB_SELECT} WHERE p.id = ?`, [id]);
  if (!p) throw new ApiError(404, 'La publicación no existe.');
  return p;
}

async function visible(id) {
  const p = await buscarPublicacion(id);
  if (p.estado !== 'VISIBLE') throw new ApiError(409, 'Esta publicación fue retirada por moderación.');
  return p;
}

async function buscarComentario(id) {
  const c = await uno(`${COM_SELECT} WHERE c.id = ?`, [id]);
  if (!c) throw new ApiError(404, 'El comentario no existe.');
  return c;
}

async function resumenLikes(publicacionId, meGusta) {
  const { total } = await uno('SELECT COUNT(*) AS total FROM publicacion_likes WHERE publicacion_id = ?', [publicacionId]);
  return { totalLikes: total, meGusta };
}

function datosPublicacion(b) {
  return {
    contenido: v.texto(b.contenido, { obligatorio: 'Escribe el contenido de la publicación.', min: 3, max: 1000, msgTam: 'La publicación debe tener entre 3 y 1000 caracteres.' }).trim(),
    imagenUrl: v.imagen(b.imagenUrl)
  };
}

function datosModeracion(b) {
  return {
    estado: v.opcion(b.estado, ESTADOS, 'El estado es obligatorio.'),
    motivo: v.limpiar(v.texto(b.motivo, { max: 255, msgTam: 'El motivo admite máximo 255 caracteres.' }))
  };
}

// =====================================================================
//  MODERACIÓN (ADMIN)
// =====================================================================

/** GET /moderacion/publicaciones?estado=OCULTA → todas (o filtradas), con todos sus comentarios. */
router.get('/moderacion/publicaciones', rol('ADMIN'), async (req, res) => {
  const estado = v.opcionDeConsulta(req, 'estado', ESTADOS);
  const filas = estado
    ? await consulta(`${PUB_SELECT} WHERE p.estado = ? ORDER BY p.fecha DESC, p.id DESC`, [estado])
    : await consulta(`${PUB_SELECT} ORDER BY p.fecha DESC, p.id DESC`);
  res.json(await armar(filas, req.usuario, true));
});

router.get('/moderacion/comentarios', rol('ADMIN'), async (req, res) => {
  const estado = v.opcionDeConsulta(req, 'estado', ESTADOS);
  const filas = estado
    ? await consulta(`${COM_SELECT} WHERE c.estado = ? ORDER BY c.fecha DESC, c.id DESC`, [estado])
    : await consulta(`${COM_SELECT} ORDER BY c.fecha DESC, c.id DESC`);
  res.json(filas.map(c => comentarioDTO(c, req.usuario)));
});

/** GET /moderacion/resumen → contadores para el panel. */
router.get('/moderacion/resumen', rol('ADMIN'), async (req, res) => {
  const p = await uno("SELECT COUNT(*) AS total, COALESCE(SUM(estado = 'OCULTA'), 0) AS ocultas FROM publicaciones");
  const c = await uno("SELECT COUNT(*) AS total, COALESCE(SUM(estado = 'OCULTA'), 0) AS ocultos FROM comentarios");
  res.json({ publicaciones: p.total, publicacionesOcultas: p.ocultas, comentarios: c.total, comentariosOcultos: c.ocultos });
});

/** PATCH /publicaciones/:id/estado → ocultar (con motivo) o restaurar. */
router.patch('/publicaciones/:id/estado', rol('ADMIN'), async (req, res) => {
  const id = v.idDeRuta(req);
  const d = datosModeracion(v.cuerpo(req));
  await buscarPublicacion(id);
  if (d.estado === 'OCULTA' && (d.motivo === null || d.motivo.length < 5))
    throw new ApiError(400, 'Escribe el motivo para ocultarla (mínimo 5 caracteres).');
  await consulta('UPDATE publicaciones SET estado = ?, motivo_moderacion = ? WHERE id = ?',
    [d.estado, d.estado === 'OCULTA' ? d.motivo : null, id]);
  res.json(await armarUna(id, req.usuario, true));
});

router.patch('/comentarios/:id/estado', rol('ADMIN'), async (req, res) => {
  const id = v.idDeRuta(req);
  const d = datosModeracion(v.cuerpo(req));
  await buscarComentario(id);
  await consulta('UPDATE comentarios SET estado = ? WHERE id = ?', [d.estado, id]);
  res.json(comentarioDTO(await buscarComentario(id), req.usuario));
});

// =====================================================================
//  MURO (todos los roles con sesión)
// =====================================================================

/** GET /api/comunidad/publicaciones → publicaciones visibles con sus comentarios visibles. */
router.get('/publicaciones', async (req, res) => {
  const filas = await consulta(`${PUB_SELECT} WHERE p.estado = 'VISIBLE' ORDER BY p.fecha DESC, p.id DESC`);
  res.json(await armar(filas, req.usuario, false));
});

/** GET /api/comunidad/publicaciones/mias → publicaciones propias (incluye las ocultas por moderación). */
router.get('/publicaciones/mias', rol('EMPRENDEDOR'), async (req, res) => {
  const filas = await consulta(`${PUB_SELECT} WHERE p.autor_id = ? ORDER BY p.fecha DESC, p.id DESC`, [req.usuario.id]);
  res.json(await armar(filas, req.usuario, false));
});

router.post('/publicaciones', rol('EMPRENDEDOR'), async (req, res) => {
  const d = datosPublicacion(v.cuerpo(req));
  const r = await consulta('INSERT INTO publicaciones (autor_id, contenido, imagen_url) VALUES (?, ?, ?)',
    [req.usuario.id, d.contenido, d.imagenUrl]);
  res.status(201).json(await armarUna(r.insertId, req.usuario, false));
});

/** PUT → solo el autor. Si estaba oculta por moderación, sigue oculta. */
router.put('/publicaciones/:id', rol('EMPRENDEDOR'), async (req, res) => {
  const id = v.idDeRuta(req);
  const d = datosPublicacion(v.cuerpo(req));
  const p = await buscarPublicacion(id);
  if (p.autor_id !== req.usuario.id) throw new ApiError(403, 'Solo el autor puede editar esta publicación.');
  await consulta('UPDATE publicaciones SET contenido = ?, imagen_url = ?, fecha_edicion = NOW(6) WHERE id = ?',
    [d.contenido, d.imagenUrl, id]);
  res.json(await armarUna(id, req.usuario, false));
});

/** DELETE → el autor o el administrador (MySQL borra comentarios y likes en cascada). */
router.delete('/publicaciones/:id', async (req, res) => {
  const p = await buscarPublicacion(v.idDeRuta(req));
  if (p.autor_id !== req.usuario.id && req.usuario.rol !== 'ADMIN')
    throw new ApiError(403, 'No puedes eliminar esta publicación.');
  await consulta('DELETE FROM publicaciones WHERE id = ?', [p.id]);
  res.status(204).end();
});

// ---------- Me gusta ----------

/** POST /publicaciones/:id/like → marca "Me gusta" (idempotente: un like por usuario). */
router.post('/publicaciones/:id/like', async (req, res) => {
  const p = await visible(v.idDeRuta(req));
  await consulta('INSERT IGNORE INTO publicacion_likes (publicacion_id, usuario_id) VALUES (?, ?)', [p.id, req.usuario.id]);
  res.json(await resumenLikes(p.id, true));
});

router.delete('/publicaciones/:id/like', async (req, res) => {
  const p = await buscarPublicacion(v.idDeRuta(req));
  await consulta('DELETE FROM publicacion_likes WHERE publicacion_id = ? AND usuario_id = ?', [p.id, req.usuario.id]);
  res.json(await resumenLikes(p.id, false));
});

// ---------- Comentarios ----------

router.post('/publicaciones/:id/comentarios', async (req, res) => {
  const id = v.idDeRuta(req);
  const contenido = v.texto(v.cuerpo(req).contenido, { obligatorio: 'Escribe tu comentario.', max: 500, msgTam: 'El comentario admite máximo 500 caracteres.' }).trim();
  const p = await visible(id);
  const r = await consulta('INSERT INTO comentarios (publicacion_id, autor_id, contenido) VALUES (?, ?, ?)',
    [p.id, req.usuario.id, contenido]);
  res.status(201).json(comentarioDTO(await buscarComentario(r.insertId), req.usuario));
});

/** DELETE /comentarios/:id → el autor del comentario, el autor de la publicación o el admin. */
router.delete('/comentarios/:id', async (req, res) => {
  const c = await buscarComentario(v.idDeRuta(req));
  const p = await buscarPublicacion(c.publicacion_id);
  const permitido = c.autor_id === req.usuario.id || p.autor_id === req.usuario.id || req.usuario.rol === 'ADMIN';
  if (!permitido) throw new ApiError(403, 'No puedes eliminar este comentario.');
  await consulta('DELETE FROM comentarios WHERE id = ?', [c.id]);
  res.status(204).end();
});

module.exports = router;
