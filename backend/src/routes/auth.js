/**
 * Autenticación: login, registro, cierre de sesión y "quién soy".
 * La sesión se mantiene con una cookie HttpOnly emitida por el servidor (sin localStorage).
 * Base: /api/auth
 */
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { consulta, uno } = require('../db');
const sesiones = require('../services/sesiones');
const { conSesion } = require('../middleware/sesion');
const { ApiError } = require('../utils/errores');
const v = require('../utils/validaciones');
const mapeos = require('../utils/mapeos');

const router = express.Router();

/** POST /api/auth/login → valida credenciales, crea la sesión y devuelve el usuario. */
router.post('/login', async (req, res) => {
  const b = v.cuerpo(req);
  const correo = v.correo(b.correo, 'El correo es obligatorio.').trim();
  const password = v.texto(b.password, { obligatorio: 'La contraseña es obligatoria.', max: 64, msgTam: 'Correo o contraseña incorrectos.' });

  const u = await uno('SELECT * FROM usuarios WHERE correo = ?', [correo]);
  if (!u || !(await bcrypt.compare(password, u.password_hash)))
    throw new ApiError(401, 'Correo o contraseña incorrectos.');
  if (!u.activo) throw new ApiError(403, 'Tu cuenta está desactivada. Contacta al administrador.');

  await sesiones.iniciar(u.id, res);
  res.json(mapeos.usuario(u));
});

/** POST /api/auth/registro → registro público (TURISTA o EMPRENDEDOR) e inicio de sesión. */
router.post('/registro', async (req, res) => {
  const b = v.cuerpo(req);
  const nombre = v.texto(b.nombre, { obligatorio: 'El nombre es obligatorio.', patron: v.RE.NOMBRE, msgPatron: v.MSG.NOMBRE }).trim();
  const correo = v.correo(b.correo, 'El correo es obligatorio.').trim().toLowerCase();
  const telefono = v.texto(b.telefono, { obligatorio: 'El teléfono es obligatorio.', patron: v.RE.TELEFONO, msgPatron: v.MSG.TELEFONO });
  const password = v.texto(b.password, { obligatorio: 'La contraseña es obligatoria.', patron: v.RE.PASSWORD, msgPatron: v.MSG.PASSWORD });
  const rol = v.opcion(b.rol, ['ADMIN', 'EMPRENDEDOR', 'TURISTA'], 'El rol es obligatorio.');

  if (rol === 'ADMIN') throw new ApiError(403, 'No es posible registrarse como administrador.');
  if (await uno('SELECT id FROM usuarios WHERE correo = ?', [correo]))
    throw new ApiError(409, 'Ya existe una cuenta con ese correo.');

  // BCrypt (factor 10): las contraseñas nunca se guardan en texto plano
  const hash = await bcrypt.hash(password, 10);
  const r = await consulta(
    'INSERT INTO usuarios (nombre, correo, telefono, password_hash, rol) VALUES (?, ?, ?, ?, ?)',
    [nombre, correo, telefono, hash, rol]);
  await sesiones.iniciar(r.insertId, res);
  res.status(201).json(mapeos.usuario(await uno('SELECT * FROM usuarios WHERE id = ?', [r.insertId])));
});

/** POST /api/auth/logout → borra la sesión de la BD y expira la cookie. */
router.post('/logout', async (req, res) => {
  await sesiones.cerrar(req, res);
  res.status(204).end();
});

/** GET /api/auth/me → usuario de la sesión actual (401 si no hay sesión). */
router.get('/me', conSesion, (req, res) => {
  res.json(req.usuario);
});

module.exports = router;
