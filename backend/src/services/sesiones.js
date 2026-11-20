/**
 * Manejo de sesiones SIN localStorage/sessionStorage:
 *  1. Al iniciar sesión se genera un token aleatorio de 256 bits.
 *  2. El token viaja al navegador en una cookie HttpOnly + SameSite=Lax (JavaScript no puede leerla).
 *  3. En MySQL (tabla "sesiones") solo se guarda su hash SHA-256 y la fecha de expiración.
 *  4. En cada petición el middleware lee la cookie y busca la sesión.
 */
'use strict';
const crypto = require('crypto');
const { consulta, uno } = require('../db');
const mapeos = require('../utils/mapeos');

const COOKIE = 'HC_SESION';
/** Duración de la sesión en horas; se renueva con el uso (expiración deslizante). */
const HORAS = 8;

const hash = token => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

function escribirCookie(res, valor, segundos) {
  res.append('Set-Cookie', `${COOKIE}=${valor}; Path=/; Max-Age=${segundos}; HttpOnly; SameSite=Lax`);
}

/** Hash de la sesión actual leído de la cookie (o null si no hay). */
function tokenHash(req) {
  const cabecera = req.headers.cookie;
  if (!cabecera) return null;
  for (const parte of cabecera.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === COOKIE) {
      const valor = parte.slice(i + 1).trim();
      return valor.length >= 40 ? hash(valor) : null;
    }
  }
  return null;
}

/** Crea la sesión en BD y escribe la cookie en la respuesta. */
async function iniciar(usuarioId, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  await consulta(
    `INSERT INTO sesiones (token_hash, usuario_id, creada, expira, ultimo_uso)
     VALUES (?, ?, NOW(6), NOW(6) + INTERVAL ? HOUR, NOW(6))`,
    [hash(token), usuarioId, HORAS]);
  escribirCookie(res, token, HORAS * 3600);
}

/**
 * Devuelve el usuario dueño de la cookie si la sesión existe, no ha vencido y la cuenta
 * sigue activa. Renueva la expiración como máximo una vez por minuto.
 */
async function resolver(req) {
  const th = tokenHash(req);
  if (!th) return null;
  const fila = await uno(
    `SELECT u.id, u.nombre, u.correo, u.telefono, u.rol, u.activo, u.foto_url, u.tema, u.fecha_registro,
            (s.expira < NOW(6)) AS vencida,
            (s.ultimo_uso < NOW(6) - INTERVAL 1 MINUTE) AS renovar
     FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ?`, [th]);
  if (!fila) return null;
  if (fila.vencida || !fila.activo) {
    await consulta('DELETE FROM sesiones WHERE token_hash = ?', [th]);
    return null;
  }
  if (fila.renovar) {
    await consulta('UPDATE sesiones SET ultimo_uso = NOW(6), expira = NOW(6) + INTERVAL ? HOUR WHERE token_hash = ?', [HORAS, th]);
  }
  return mapeos.usuario(fila);
}

/** Elimina la sesión actual y borra la cookie. */
async function cerrar(req, res) {
  const th = tokenHash(req);
  if (th) await consulta('DELETE FROM sesiones WHERE token_hash = ?', [th]);
  escribirCookie(res, '', 0);
}

/** Cierra todas las sesiones de un usuario excepto la indicada (tras cambiar contraseña). */
const cerrarOtras = (usuarioId, conservar) =>
  consulta('DELETE FROM sesiones WHERE usuario_id = ? AND token_hash <> ?', [usuarioId, conservar]);

/** Cierra todas las sesiones de un usuario (al desactivarlo). */
const cerrarTodas = usuarioId => consulta('DELETE FROM sesiones WHERE usuario_id = ?', [usuarioId]);

/** Cada hora se borran de la BD las sesiones vencidas. */
function programarLimpieza() {
  setInterval(() => {
    consulta('DELETE FROM sesiones WHERE expira < NOW(6)').catch(() => { /* se reintenta en la próxima hora */ });
  }, 3600000).unref();
}

module.exports = { COOKIE, iniciar, resolver, cerrar, tokenHash, cerrarOtras, cerrarTodas, programarLimpieza };
