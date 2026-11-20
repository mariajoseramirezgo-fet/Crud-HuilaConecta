/**
 * Usuarios:
 *  - CRUD global (solo ADMIN): /api/usuarios
 *  - Cuenta propia (cualquier rol): /api/usuarios/me, /me/foto, /me/password, /me/tema
 *  - Favoritos (TURISTA): /api/usuarios/me/favoritos
 *
 * Importante: las rutas "/me..." se declaran ANTES que "/:id" para que Express no
 * confunda "me" con un id.
 */
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { consulta, uno } = require('../db');
const sesiones = require('../services/sesiones');
const { conSesion, rol } = require('../middleware/sesion');
const { ApiError } = require('../utils/errores');
const v = require('../utils/validaciones');
const mapeos = require('../utils/mapeos');

const router = express.Router();
const ROLES = ['ADMIN', 'EMPRENDEDOR', 'TURISTA'];
const SITIO_SELECT = `SELECT s.*, u.nombre AS emprendedor_nombre
                      FROM sitios_turisticos s JOIN usuarios u ON u.id = s.emprendedor_id`;

// ---------- Utilidades ----------
async function buscar(id) {
  const u = await uno('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!u) throw new ApiError(404, 'El usuario no existe.');
  return u;
}

async function validarCorreoUnico(correo, idActual) {
  const existe = await uno('SELECT id FROM usuarios WHERE correo = ? AND id <> ?', [correo, idActual || 0]);
  if (existe) throw new ApiError(409, 'Ya existe una cuenta con ese correo.');
}

/** Nombre, correo y teléfono: comunes al perfil propio y al CRUD del administrador. */
function datosBasicos(b) {
  return {
    nombre: v.texto(b.nombre, { obligatorio: 'El nombre es obligatorio.', patron: v.RE.NOMBRE, msgPatron: v.MSG.NOMBRE }).trim(),
    correo: v.correo(b.correo, 'El correo es obligatorio.').trim().toLowerCase(),
    telefono: v.texto(b.telefono, { obligatorio: 'El teléfono es obligatorio.', patron: v.RE.TELEFONO, msgPatron: v.MSG.TELEFONO })
  };
}

/** Alta/edición por el administrador. La contraseña es opcional al editar. */
function datosAdmin(b) {
  const d = datosBasicos(b);
  d.rol = v.opcion(b.rol, ROLES, 'El rol es obligatorio.');
  d.activo = v.booleano(b.activo);
  d.password = v.limpiar(v.texto(b.password));
  if (d.password !== null && !v.RE.PASSWORD.test(d.password)) throw new ApiError(400, v.MSG.PASSWORD);
  return d;
}

const idsFavoritos = async usuarioId =>
  (await consulta('SELECT sitio_id FROM favoritos WHERE usuario_id = ? ORDER BY sitio_id', [usuarioId])).map(f => f.sitio_id);

// =====================================================================
//  CUENTA PROPIA (CUALQUIER ROL)
// =====================================================================

/** PUT /api/usuarios/me → nombre, correo y teléfono. */
router.put('/me', conSesion, async (req, res) => {
  const d = datosBasicos(v.cuerpo(req));
  await validarCorreoUnico(d.correo, req.usuario.id);
  await consulta('UPDATE usuarios SET nombre = ?, correo = ?, telefono = ? WHERE id = ?',
    [d.nombre, d.correo, d.telefono, req.usuario.id]);
  res.json(mapeos.usuario(await buscar(req.usuario.id)));
});

/** PUT /api/usuarios/me/foto → {fotoUrl: "https://…" | "/api/archivos/7" | null para quitarla}. */
router.put('/me/foto', conSesion, async (req, res) => {
  const fotoUrl = v.imagen(v.cuerpo(req).fotoUrl);
  await consulta('UPDATE usuarios SET foto_url = ? WHERE id = ?', [fotoUrl, req.usuario.id]);
  res.json(mapeos.usuario(await buscar(req.usuario.id)));
});

/**
 * PUT /api/usuarios/me/password → exige la contraseña actual, guarda el nuevo hash BCrypt
 * y cierra las demás sesiones abiertas (otros dispositivos) por seguridad.
 */
router.put('/me/password', conSesion, async (req, res) => {
  const b = v.cuerpo(req);
  const actual = v.texto(b.actual, { obligatorio: 'Ingresa tu contraseña actual.' });
  const nueva = v.texto(b.nueva, { obligatorio: 'Ingresa la nueva contraseña.', patron: v.RE.PASSWORD, msgPatron: v.MSG.PASSWORD });

  const u = await buscar(req.usuario.id);
  if (!(await bcrypt.compare(actual, u.password_hash)))
    throw new ApiError(401, 'La contraseña actual no es correcta.');
  if (await bcrypt.compare(nueva, u.password_hash))
    throw new ApiError(400, 'La nueva contraseña debe ser diferente a la actual.');

  await consulta('UPDATE usuarios SET password_hash = ? WHERE id = ?', [await bcrypt.hash(nueva, 10), u.id]);
  const sesionActual = sesiones.tokenHash(req);
  if (sesionActual) await sesiones.cerrarOtras(u.id, sesionActual);
  res.json({ mensaje: 'Contraseña actualizada. Se cerraron tus sesiones en otros dispositivos.' });
});

/** PUT /api/usuarios/me/tema → guarda la preferencia de modo claro/oscuro. */
router.put('/me/tema', conSesion, async (req, res) => {
  const tema = v.texto(v.cuerpo(req).tema, { obligatorio: 'Tema no válido.', patron: /^(light|dark)$/, msgPatron: 'Tema no válido.' });
  await consulta('UPDATE usuarios SET tema = ? WHERE id = ?', [tema, req.usuario.id]);
  res.json(mapeos.usuario(await buscar(req.usuario.id)));
});

/** DELETE /api/usuarios/me → el turista o emprendedor elimina su cuenta (confirma con contraseña). */
router.delete('/me', rol('TURISTA', 'EMPRENDEDOR'), async (req, res) => {
  const password = v.texto(v.cuerpo(req).password, { obligatorio: 'Confirma con tu contraseña.' });
  const u = await buscar(req.usuario.id);
  if (!(await bcrypt.compare(password, u.password_hash)))
    throw new ApiError(401, 'La contraseña no es correcta.');
  await sesiones.cerrar(req, res);
  // MySQL elimina en cascada sus sesiones, sitios, productos, favoritos, fotos, publicaciones,
  // comentarios y likes. Los pedidos del turista se conservan con turista_id = NULL.
  await consulta('DELETE FROM usuarios WHERE id = ?', [u.id]);
  res.status(204).end();
});

// =====================================================================
//  FAVORITOS (TURISTA)
// =====================================================================

/** GET /api/usuarios/me/favoritos → sitios completos (solo aprobados). */
router.get('/me/favoritos', rol('TURISTA'), async (req, res) => {
  const filas = await consulta(
    `${SITIO_SELECT} JOIN favoritos f ON f.sitio_id = s.id
     WHERE f.usuario_id = ? AND s.estado = 'APROBADO' ORDER BY s.id`, [req.usuario.id]);
  res.json(filas.map(mapeos.sitio));
});

router.post('/me/favoritos/:sitioId', rol('TURISTA'), async (req, res) => {
  const sitioId = v.idDeRuta(req, 'sitioId');
  const s = await uno('SELECT estado FROM sitios_turisticos WHERE id = ?', [sitioId]);
  if (!s) throw new ApiError(404, 'El sitio no existe.');
  if (s.estado !== 'APROBADO') throw new ApiError(409, 'Solo puedes guardar sitios aprobados.');
  await consulta('INSERT IGNORE INTO favoritos (usuario_id, sitio_id) VALUES (?, ?)', [req.usuario.id, sitioId]);
  res.json({ favoritos: await idsFavoritos(req.usuario.id) });
});

router.delete('/me/favoritos/:sitioId', rol('TURISTA'), async (req, res) => {
  const sitioId = v.idDeRuta(req, 'sitioId');
  await consulta('DELETE FROM favoritos WHERE usuario_id = ? AND sitio_id = ?', [req.usuario.id, sitioId]);
  res.json({ favoritos: await idsFavoritos(req.usuario.id) });
});

// =====================================================================
//  CRUD GLOBAL (ADMINISTRADOR)
// =====================================================================

/** GET /api/usuarios?rol=TURISTA (filtro opcional). */
router.get('/', rol('ADMIN'), async (req, res) => {
  const filtro = v.opcionDeConsulta(req, 'rol', ROLES);
  const filas = filtro
    ? await consulta('SELECT * FROM usuarios WHERE rol = ? ORDER BY nombre ASC', [filtro])
    : await consulta('SELECT * FROM usuarios ORDER BY fecha_registro DESC, id DESC');
  res.json(filas.map(mapeos.usuario));
});

router.get('/:id', rol('ADMIN'), async (req, res) => {
  res.json(mapeos.usuario(await buscar(v.idDeRuta(req))));
});

/** POST /api/usuarios → crea cualquier rol. La contraseña es obligatoria. */
router.post('/', rol('ADMIN'), async (req, res) => {
  const d = datosAdmin(v.cuerpo(req));
  if (d.password === null) throw new ApiError(400, 'La contraseña es obligatoria para un usuario nuevo.');
  await validarCorreoUnico(d.correo, null);
  const r = await consulta(
    'INSERT INTO usuarios (nombre, correo, telefono, password_hash, rol, activo) VALUES (?, ?, ?, ?, ?, ?)',
    [d.nombre, d.correo, d.telefono, await bcrypt.hash(d.password, 10), d.rol, d.activo === null || d.activo]);
  res.status(201).json(mapeos.usuario(await buscar(r.insertId)));
});

/** PUT /api/usuarios/:id → el admin no puede quitarse su propio rol ni desactivarse. */
router.put('/:id', rol('ADMIN'), async (req, res) => {
  const id = v.idDeRuta(req);
  const d = datosAdmin(v.cuerpo(req));
  const u = await buscar(id);
  if (u.id === req.usuario.id && (d.rol !== 'ADMIN' || d.activo === false))
    throw new ApiError(409, 'No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.');
  await validarCorreoUnico(d.correo, id);

  const activo = d.activo === null ? mapeos.bool(u.activo) : d.activo;
  const hash = d.password === null ? u.password_hash : await bcrypt.hash(d.password, 10);
  await consulta(
    'UPDATE usuarios SET nombre = ?, correo = ?, telefono = ?, rol = ?, activo = ?, password_hash = ? WHERE id = ?',
    [d.nombre, d.correo, d.telefono, d.rol, activo, hash, id]);
  if (!activo) await sesiones.cerrarTodas(id); // una cuenta desactivada pierde sus sesiones
  res.json(mapeos.usuario(await buscar(id)));
});

/** DELETE /api/usuarios/:id → elimina en cascada (ON DELETE CASCADE en MySQL). */
router.delete('/:id', rol('ADMIN'), async (req, res) => {
  const u = await buscar(v.idDeRuta(req));
  if (u.id === req.usuario.id)
    throw new ApiError(409, 'No puedes eliminar tu propia cuenta desde el panel.');
  if (u.rol === 'ADMIN') {
    const { total } = await uno("SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'ADMIN'");
    if (total <= 1) throw new ApiError(409, 'No puedes eliminar al único administrador.');
  }
  await consulta('DELETE FROM usuarios WHERE id = ?', [u.id]);
  res.status(204).end();
});

module.exports = router;
