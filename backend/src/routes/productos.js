/**
 * Menú de "Cafetería Sin Fila".
 *  - El emprendedor gestiona los productos de sus sitios de categoría "Sabores".
 *  - El turista consulta el menú disponible de un restaurante aprobado.
 * Base: /api/productos
 */
'use strict';
const express = require('express');
const { consulta, uno } = require('../db');
const { rol } = require('../middleware/sesion');
const { ApiError } = require('../utils/errores');
const v = require('../utils/validaciones');
const mapeos = require('../utils/mapeos');

const router = express.Router();
const SELECT = `SELECT p.*, s.nombre AS sitio_nombre, s.emprendedor_id
                FROM productos p JOIN sitios_turisticos s ON s.id = p.sitio_id`;

async function buscar(id) {
  const p = await uno(`${SELECT} WHERE p.id = ?`, [id]);
  if (!p) throw new ApiError(404, 'El producto no existe.');
  return p;
}

async function propio(id, yo) {
  const p = await buscar(id);
  if (p.emprendedor_id !== yo.id) throw new ApiError(403, 'Este producto no te pertenece.');
  return p;
}

/** Valida los datos y comprueba que el sitio sea del emprendedor y de categoría Sabores. */
async function datosProducto(b, yo) {
  const disponible = v.booleano(b.disponible);
  const d = {
    sitioId: v.numero(b.sitioId, { obligatorio: 'Selecciona el restaurante o cafetería.', entero: 'Selecciona el restaurante o cafetería.' }),
    nombre: v.texto(b.nombre, { obligatorio: 'El nombre es obligatorio.', min: 3, max: 80, msgTam: 'El nombre debe tener entre 3 y 80 caracteres.' }).trim(),
    descripcion: v.limpiar(v.texto(b.descripcion, { max: 300, msgTam: 'La descripción admite máximo 300 caracteres.' })),
    precio: v.numero(b.precio, {
      obligatorio: 'El precio es obligatorio.', entero: 'El precio no admite decimales.',
      min: 500, msgMin: 'El precio mínimo es $500.', max: 1000000, msgMax: 'El precio máximo es $1.000.000.'
    }),
    imagenUrl: v.imagen(b.imagenUrl),
    disponible: disponible === null || disponible
  };
  const s = await uno('SELECT emprendedor_id, categoria FROM sitios_turisticos WHERE id = ?', [d.sitioId]);
  if (!s) throw new ApiError(404, 'El sitio no existe.');
  if (s.emprendedor_id !== yo.id) throw new ApiError(403, 'Solo puedes agregar productos a tus propios sitios.');
  if (s.categoria !== 'Sabores') throw new ApiError(400, 'El menú solo aplica a sitios de la categoría Sabores.');
  return d;
}

/** GET /api/productos/sitio/:sitioId → menú disponible de un restaurante aprobado (público). */
router.get('/sitio/:sitioId', async (req, res) => {
  const sitioId = v.idDeRuta(req, 'sitioId');
  const s = await uno("SELECT id FROM sitios_turisticos WHERE id = ? AND estado = 'APROBADO'", [sitioId]);
  if (!s) throw new ApiError(404, 'El restaurante no existe.');
  const filas = await consulta(`${SELECT} WHERE p.sitio_id = ? AND p.disponible = TRUE ORDER BY p.nombre ASC`, [sitioId]);
  res.json(filas.map(mapeos.producto));
});

/** GET /api/productos/mios → todos los productos de los sitios del emprendedor. */
router.get('/mios', rol('EMPRENDEDOR'), async (req, res) => {
  const filas = await consulta(`${SELECT} WHERE s.emprendedor_id = ? ORDER BY p.nombre ASC`, [req.usuario.id]);
  res.json(filas.map(mapeos.producto));
});

router.post('/', rol('EMPRENDEDOR'), async (req, res) => {
  const d = await datosProducto(v.cuerpo(req), req.usuario);
  const r = await consulta(
    'INSERT INTO productos (sitio_id, nombre, descripcion, precio, imagen_url, disponible) VALUES (?, ?, ?, ?, ?, ?)',
    [d.sitioId, d.nombre, d.descripcion, d.precio, d.imagenUrl, d.disponible]);
  res.status(201).json(mapeos.producto(await buscar(r.insertId)));
});

router.put('/:id', rol('EMPRENDEDOR'), async (req, res) => {
  const id = v.idDeRuta(req);
  const b = v.cuerpo(req);
  await propio(id, req.usuario);
  const d = await datosProducto(b, req.usuario);
  await consulta(
    'UPDATE productos SET sitio_id = ?, nombre = ?, descripcion = ?, precio = ?, imagen_url = ?, disponible = ? WHERE id = ?',
    [d.sitioId, d.nombre, d.descripcion, d.precio, d.imagenUrl, d.disponible, id]);
  res.json(mapeos.producto(await buscar(id)));
});

/** PATCH /api/productos/:id/disponible → marca agotado / disponible rápidamente. */
router.patch('/:id/disponible', rol('EMPRENDEDOR'), async (req, res) => {
  const id = v.idDeRuta(req);
  const disponible = v.cuerpo(req).disponible === true;
  await propio(id, req.usuario);
  await consulta('UPDATE productos SET disponible = ? WHERE id = ?', [disponible, id]);
  res.json(mapeos.producto(await buscar(id)));
});

/** DELETE → el historial de pedidos conserva nombre y precio (pedido_items.producto_id queda NULL). */
router.delete('/:id', rol('EMPRENDEDOR'), async (req, res) => {
  const p = await propio(v.idDeRuta(req), req.usuario);
  await consulta('DELETE FROM productos WHERE id = ?', [p.id]);
  res.status(204).end();
});

module.exports = router;
