/**
 * Subida y descarga de imágenes desde el PC.
 *  - POST /api/archivos  (multipart, campo "archivo") → {id, url}
 *  - GET  /api/archivos/:id → bytes de la imagen (público, para poder mostrarla en <img>)
 *
 * Seguridad: solo JPG, PNG, WEBP o GIF de máximo 2 MB. Se verifica la "firma" real del
 * archivo (primeros bytes), no solo la extensión. SVG no se acepta porque puede contener scripts.
 * Los bytes se guardan en MySQL (tabla archivos, MEDIUMBLOB): la imagen viaja con la base de datos.
 */
'use strict';
const express = require('express');
const multer = require('multer');
const { consulta, uno } = require('../db');
const { conSesion } = require('../middleware/sesion');
const { ApiError } = require('../utils/errores');
const v = require('../utils/validaciones');

const router = express.Router();
const MAX_BYTES = 2 * 1024 * 1024;

// multer deja el archivo en memoria (req.file.buffer). Se da un margen de 3 MB y luego se valida a 2 MB.
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } }).single('archivo');

/** Identifica el formato por sus "números mágicos". Devuelve null si no es una imagen permitida. */
function detectarTipo(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

router.post('/', conSesion, subida, async (req, res) => {
  const archivo = req.file;
  if (!archivo) throw new ApiError(400, 'Selecciona un archivo de imagen.');
  if (archivo.size === 0) throw new ApiError(400, 'El archivo está vacío.');
  if (archivo.size > MAX_BYTES) throw new ApiError(413, 'La imagen supera el tamaño máximo de 2 MB.');
  const tipo = detectarTipo(archivo.buffer);
  if (!tipo) throw new ApiError(415, 'Formato no permitido. Usa JPG, PNG, WEBP o GIF.');

  let nombre = (archivo.originalname || 'imagen').replace(/[^A-Za-z0-9._ -]/g, '_');
  if (nombre.length > 150) nombre = nombre.slice(-150);

  const r = await consulta(
    'INSERT INTO archivos (nombre, tipo_mime, tamano, datos, propietario_id) VALUES (?, ?, ?, ?, ?)',
    [nombre, tipo, archivo.size, archivo.buffer, req.usuario.id]);
  res.status(201).json({ id: r.insertId, url: `/api/archivos/${r.insertId}`, nombre, tamano: archivo.size });
});

/** Devuelve la imagen con su tipo MIME y caché de 1 día. */
router.get('/:id', async (req, res) => {
  const a = await uno('SELECT tipo_mime, datos FROM archivos WHERE id = ?', [v.idDeRuta(req)]);
  if (!a) throw new ApiError(404, 'La imagen no existe.');
  res.set({
    'Content-Type': a.tipo_mime,
    'Cache-Control': 'max-age=86400, public',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(a.datos);
});

module.exports = router;
