/**
 * Guías turísticos de la región.
 *  - Lectura pública (turistas y landing): solo guías activos.
 *  - CRUD completo: ADMIN.
 * Base: /api/guias
 */
'use strict';
const express = require('express');
const { consulta, uno } = require('../db');
const { rol } = require('../middleware/sesion');
const { ApiError } = require('../utils/errores');
const v = require('../utils/validaciones');
const mapeos = require('../utils/mapeos');

const router = express.Router();
const esAdmin = yo => Boolean(yo && yo.rol === 'ADMIN');

async function buscar(id) {
  const g = await uno('SELECT * FROM guias WHERE id = ?', [id]);
  if (!g) throw new ApiError(404, 'El guía no existe.');
  return g;
}

function datosGuia(b) {
  const correo = v.limpiar(v.correo(b.correo));
  const calificacion = v.numero(b.calificacion, {
    obligatorio: 'La calificación es obligatoria.',
    min: 1, max: 5, msgMin: 'La calificación va de 1.0 a 5.0.', msgMax: 'La calificación va de 1.0 a 5.0.'
  });
  if (!Number.isInteger(Math.round(calificacion * 1e6) / 1e5)) throw new ApiError(400, 'La calificación admite un decimal.');
  const activo = v.booleano(b.activo);
  return [
    v.texto(b.nombre, { obligatorio: 'El nombre es obligatorio.', patron: v.RE.NOMBRE, msgPatron: v.MSG.NOMBRE }).trim(),
    v.imagen(b.fotoUrl),
    v.texto(b.especialidad, { obligatorio: 'La especialidad es obligatoria.', min: 3, max: 100, msgTam: 'La especialidad debe tener entre 3 y 100 caracteres.' }).trim(),
    v.texto(b.idiomas, { obligatorio: 'Indica al menos un idioma.', patron: /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ,]{3,120}$/, msgPatron: 'Los idiomas solo admiten letras separadas por comas.' }).trim(),
    v.texto(b.municipios, { obligatorio: 'Indica los municipios.', patron: /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ .,-]{3,200}$/, msgPatron: 'Los municipios solo admiten letras separadas por comas.' }).trim(),
    v.numero(b.experienciaAnios, {
      obligatorio: 'Indica los años de experiencia.', entero: 'Indica los años de experiencia.',
      min: 0, msgMin: 'La experiencia no puede ser negativa.', max: 60, msgMax: 'La experiencia máxima es 60 años.'
    }),
    v.texto(b.telefono, { obligatorio: 'El teléfono es obligatorio.', patron: v.RE.TELEFONO, msgPatron: v.MSG.TELEFONO }),
    correo === null ? null : correo.toLowerCase(),
    v.limpiar(v.texto(b.rnt, { patron: /^$|^[0-9]{4,10}$/, msgPatron: 'El RNT solo admite números (4 a 10 dígitos).' })),
    v.numero(b.tarifaDia, {
      obligatorio: 'La tarifa es obligatoria.', entero: 'La tarifa no admite decimales.',
      min: 10000, msgMin: 'La tarifa mínima es $10.000.', max: 5000000, msgMax: 'La tarifa máxima es $5.000.000.'
    }),
    calificacion,
    v.texto(b.descripcion, { obligatorio: 'La descripción es obligatoria.', min: 20, max: 1000, msgTam: 'La descripción debe tener entre 20 y 1000 caracteres.' }).trim(),
    activo === null || activo
  ];
}

/** GET /api/guias → activos (público). El admin recibe también los inactivos. */
router.get('/', async (req, res) => {
  const filas = esAdmin(req.usuario)
    ? await consulta('SELECT * FROM guias ORDER BY nombre ASC')
    : await consulta('SELECT * FROM guias WHERE activo = TRUE ORDER BY calificacion DESC, nombre ASC');
  res.json(filas.map(mapeos.guia));
});

router.get('/:id', async (req, res) => {
  const g = await buscar(v.idDeRuta(req));
  if (!g.activo && !esAdmin(req.usuario)) throw new ApiError(404, 'El guía no existe.');
  res.json(mapeos.guia(g));
});

router.post('/', rol('ADMIN'), async (req, res) => {
  const r = await consulta(
    `INSERT INTO guias (nombre, foto_url, especialidad, idiomas, municipios, experiencia_anios, telefono,
                        correo, rnt, tarifa_dia, calificacion, descripcion, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, datosGuia(v.cuerpo(req)));
  res.status(201).json(mapeos.guia(await buscar(r.insertId)));
});

router.put('/:id', rol('ADMIN'), async (req, res) => {
  const id = v.idDeRuta(req);
  const datos = datosGuia(v.cuerpo(req));
  await buscar(id);
  await consulta(
    `UPDATE guias SET nombre = ?, foto_url = ?, especialidad = ?, idiomas = ?, municipios = ?,
            experiencia_anios = ?, telefono = ?, correo = ?, rnt = ?, tarifa_dia = ?, calificacion = ?,
            descripcion = ?, activo = ?
     WHERE id = ?`, [...datos, id]);
  res.json(mapeos.guia(await buscar(id)));
});

router.delete('/:id', rol('ADMIN'), async (req, res) => {
  const g = await buscar(v.idDeRuta(req));
  await consulta('DELETE FROM guias WHERE id = ?', [g.id]);
  res.status(204).end();
});

module.exports = router;
