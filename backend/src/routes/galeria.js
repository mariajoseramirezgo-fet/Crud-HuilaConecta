/**
 * Galería de fotos personales del turista (CRUD propio).
 * Base: /api/usuarios/me/fotos
 */
'use strict';
const express = require('express');
const { consulta, uno } = require('../db');
const { rol } = require('../middleware/sesion');
const { ApiError } = require('../utils/errores');
const v = require('../utils/validaciones');
const mapeos = require('../utils/mapeos');

const router = express.Router();
router.use(rol('TURISTA'));

/** Máximo de fotos por turista (evita llenar la base de datos). */
const MAX_FOTOS = 60;
const COLUMNAS = 'id, url, descripcion, fecha_subida';
const MSG_DESCRIPCION = 'La descripción admite máximo 200 caracteres.';

/** Garantiza que solo el dueño acceda a su foto. */
async function propia(id, yo) {
  const f = await uno(`SELECT ${COLUMNAS} FROM fotos_usuario WHERE id = ? AND usuario_id = ?`, [id, yo.id]);
  if (!f) throw new ApiError(404, 'La foto no existe.');
  return f;
}

router.get('/', async (req, res) => {
  const filas = await consulta(
    `SELECT ${COLUMNAS} FROM fotos_usuario WHERE usuario_id = ? ORDER BY fecha_subida DESC, id DESC`, [req.usuario.id]);
  res.json(filas.map(mapeos.foto));
});

router.post('/', async (req, res) => {
  const b = v.cuerpo(req);
  const url = v.texto(b.url, { obligatorio: 'Selecciona una imagen.', max: 500, msgTam: v.MSG.IMAGEN, patron: v.RE.IMAGEN, msgPatron: v.MSG.IMAGEN }).trim();
  const descripcion = v.limpiar(v.texto(b.descripcion, { max: 200, msgTam: MSG_DESCRIPCION }));

  const { total } = await uno('SELECT COUNT(*) AS total FROM fotos_usuario WHERE usuario_id = ?', [req.usuario.id]);
  if (total >= MAX_FOTOS) throw new ApiError(409, `Alcanzaste el máximo de ${MAX_FOTOS} fotos.`);

  const r = await consulta('INSERT INTO fotos_usuario (usuario_id, url, descripcion) VALUES (?, ?, ?)',
    [req.usuario.id, url, descripcion]);
  res.status(201).json(mapeos.foto(await propia(r.insertId, req.usuario)));
});

router.put('/:id', async (req, res) => {
  const id = v.idDeRuta(req);
  const descripcion = v.limpiar(v.texto(v.cuerpo(req).descripcion, { max: 200, msgTam: MSG_DESCRIPCION }));
  await propia(id, req.usuario);
  await consulta('UPDATE fotos_usuario SET descripcion = ? WHERE id = ?', [descripcion, id]);
  res.json(mapeos.foto(await propia(id, req.usuario)));
});

router.delete('/:id', async (req, res) => {
  const f = await propia(v.idDeRuta(req), req.usuario);
  await consulta('DELETE FROM fotos_usuario WHERE id = ?', [f.id]);
  res.status(204).end();
});

module.exports = router;
