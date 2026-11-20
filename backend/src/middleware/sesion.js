/**
 * Guardián de la API. Antes de cada ruta:
 *  - cargarUsuario: identifica al usuario a partir de la cookie (queda en req.usuario o null).
 *  - conSesion:     si no hay sesión → 401.
 *  - rol(...):      si no hay sesión → 401; si el rol no coincide → 403.
 * Las rutas públicas (catálogo, guías, imágenes, login) simplemente no usan conSesion ni rol.
 */
'use strict';
const sesiones = require('../services/sesiones');
const { ApiError } = require('../utils/errores');

async function cargarUsuario(req, res, next) {
  req.usuario = await sesiones.resolver(req);
  next();
}

function conSesion(req, res, next) {
  if (!req.usuario) throw new ApiError(401, 'Tu sesión terminó. Inicia sesión de nuevo.');
  next();
}

const rol = (...roles) => (req, res, next) => {
  if (!req.usuario) throw new ApiError(401, 'Tu sesión terminó. Inicia sesión de nuevo.');
  if (!roles.includes(req.usuario.rol)) throw new ApiError(403, 'No tienes permiso para realizar esta acción.');
  next();
};

module.exports = { cargarUsuario, conSesion, rol };
