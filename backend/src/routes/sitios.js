/**
 * Sitios turísticos: catálogo público, CRUD del emprendedor y moderación del administrador.
 * Base: /api/sitios
 */
'use strict';
const express = require('express');
const { consulta, uno } = require('../db');
const { rol } = require('../middleware/sesion');
const { ApiError } = require('../utils/errores');
const v = require('../utils/validaciones');
const mapeos = require('../utils/mapeos');

const router = express.Router();
const ESTADOS = ['PENDIENTE', 'APROBADO', 'RECHAZADO'];
const CATEGORIAS = ['Experiencias', 'Hospedaje', 'Sabores', 'Transporte'];
const SELECT = `SELECT s.*, u.nombre AS emprendedor_nombre
                FROM sitios_turisticos s JOIN usuarios u ON u.id = s.emprendedor_id`;

// ================= Utilidades =================
async function buscar(id) {
  const s = await uno(`${SELECT} WHERE s.id = ?`, [id]);
  if (!s) throw new ApiError(404, 'El sitio no existe.');
  return s;
}

async function propio(id, yo) {
  const s = await buscar(id);
  if (s.emprendedor_id !== yo.id) throw new ApiError(403, 'Solo el emprendedor dueño puede editar este servicio.');
  return s;
}

function categoriaValida(req) {
  const c = v.limpiar(req.query.categoria);
  if (c !== null && !CATEGORIAS.includes(c)) throw new ApiError(400, 'Categoría no válida.');
  return c;
}

/**
 * Filtro avanzado: cada parámetro es opcional (null = sin filtrar).
 * Se usa en el panel del administrador y en el catálogo público.
 */
async function filtrar(estado, categoria, q) {
  const condiciones = [];
  const parametros = [];
  if (estado) { condiciones.push('s.estado = ?'); parametros.push(estado); }
  if (categoria) { condiciones.push('s.categoria = ?'); parametros.push(categoria); }
  if (q) {
    condiciones.push(`(s.nombre LIKE CONCAT('%', ?, '%') OR s.municipio LIKE CONCAT('%', ?, '%')
                       OR s.descripcion LIKE CONCAT('%', ?, '%') OR u.nombre LIKE CONCAT('%', ?, '%'))`);
    parametros.push(q, q, q, q);
  }
  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  const filas = await consulta(`${SELECT} ${where} ORDER BY s.fecha_creacion DESC, s.id DESC`, parametros);
  return filas.map(mapeos.sitio);
}

/** Datos que envía el emprendedor al crear o editar un servicio. La ubicación es opcional. */
function datosSitio(b) {
  const d = {
    nombre: v.texto(b.nombre, { obligatorio: 'El nombre es obligatorio.', min: 3, max: 100, msgTam: 'El nombre debe tener entre 3 y 100 caracteres.' }).trim(),
    categoria: v.texto(b.categoria, { obligatorio: 'La categoría es obligatoria.', patron: v.RE.CATEGORIA, msgPatron: 'Categoría no válida.' }),
    municipio: v.texto(b.municipio, { obligatorio: 'El municipio es obligatorio.', patron: v.RE.MUNICIPIO, msgPatron: 'El municipio solo admite letras.' }).trim(),
    descripcion: v.texto(b.descripcion, { obligatorio: 'La descripción es obligatoria.', min: 20, max: 1000, msgTam: 'La descripción debe tener entre 20 y 1000 caracteres.' }).trim(),
    precio: v.numero(b.precio, {
      obligatorio: 'El precio es obligatorio.', entero: 'El precio no admite decimales.',
      min: 1000, msgMin: 'El precio mínimo es $1.000 COP.', max: 50000000, msgMax: 'El precio máximo es $50.000.000 COP.'
    }),
    telefono: v.texto(b.telefono, { obligatorio: 'El teléfono es obligatorio.', patron: v.RE.TELEFONO, msgPatron: v.MSG.TELEFONO }),
    imagenUrl: v.imagen(b.imagenUrl),
    direccion: v.limpiar(v.texto(b.direccion, { max: 160, msgTam: 'La dirección admite máximo 160 caracteres.' })),
    horario: v.limpiar(v.texto(b.horario, { max: 120, msgTam: 'El horario admite máximo 120 caracteres.' })),
    // Coordenadas aproximadas del departamento del Huila
    latitud: v.numero(b.latitud, { min: 1, max: 4, msgMin: 'La latitud está fuera del Huila (1.0 a 4.0).', msgMax: 'La latitud está fuera del Huila (1.0 a 4.0).' }),
    longitud: v.numero(b.longitud, { min: -77, max: -74, msgMin: 'La longitud está fuera del Huila (-77.0 a -74.0).', msgMax: 'La longitud está fuera del Huila (-77.0 a -74.0).' })
  };
  if ((d.latitud === null) !== (d.longitud === null))
    throw new ApiError(400, 'Escribe la latitud y la longitud juntas, o deja ambas vacías.');
  return d;
}

// ================= LECTURA =================

/** GET /api/sitios?estado=&categoria=&q= → todos los sitios con filtros avanzados (ADMIN). */
router.get('/', rol('ADMIN'), async (req, res) => {
  const estado = v.opcionDeConsulta(req, 'estado', ESTADOS);
  res.json(await filtrar(estado, categoriaValida(req), v.limpiar(req.query.q)));
});

/** GET /api/sitios/aprobados?categoria=Sabores&q=café → catálogo público. */
router.get('/aprobados', async (req, res) => {
  res.json(await filtrar('APROBADO', categoriaValida(req), v.limpiar(req.query.q)));
});

/** GET /api/sitios/mios → servicios propios del emprendedor (todos los estados). */
router.get('/mios', rol('EMPRENDEDOR'), async (req, res) => {
  const filas = await consulta(`${SELECT} WHERE s.emprendedor_id = ? ORDER BY s.fecha_creacion DESC, s.id DESC`, [req.usuario.id]);
  res.json(filas.map(mapeos.sitio));
});

/** GET /api/sitios/estadisticas → contadores por estado y por categoría (ADMIN). */
router.get('/estadisticas', rol('ADMIN'), async (req, res) => {
  const filas = await consulta('SELECT categoria, estado, COUNT(*) AS total FROM sitios_turisticos GROUP BY categoria, estado');
  const cuenta = estado => filas.filter(f => f.estado === estado).reduce((suma, f) => suma + f.total, 0);
  const aprobadosPorCategoria = {};
  for (const c of CATEGORIAS) {
    const f = filas.find(x => x.categoria === c && x.estado === 'APROBADO');
    aprobadosPorCategoria[c] = f ? f.total : 0;
  }
  res.json({
    total: filas.reduce((suma, f) => suma + f.total, 0),
    pendientes: cuenta('PENDIENTE'),
    aprobados: cuenta('APROBADO'),
    rechazados: cuenta('RECHAZADO'),
    aprobadosPorCategoria
  });
});

/** GET /api/sitios/:id → público si está aprobado; si no, solo para su dueño o el admin. */
router.get('/:id', async (req, res) => {
  const s = await buscar(v.idDeRuta(req));
  const yo = req.usuario;
  const puedeVer = s.estado === 'APROBADO' || (yo && (yo.rol === 'ADMIN' || yo.id === s.emprendedor_id));
  if (!puedeVer) throw new ApiError(404, 'El sitio no existe.');
  res.json(mapeos.sitio(s));
});

// ================= CRUD DEL EMPRENDEDOR =================

/** POST /api/sitios → todo sitio nuevo queda PENDIENTE de moderación. */
router.post('/', rol('EMPRENDEDOR'), async (req, res) => {
  const d = datosSitio(v.cuerpo(req));
  const r = await consulta(
    `INSERT INTO sitios_turisticos
       (nombre, categoria, municipio, descripcion, precio, telefono, imagen_url, direccion, horario,
        latitud, longitud, estado, emprendedor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?)`,
    [d.nombre, d.categoria, d.municipio, d.descripcion, d.precio, d.telefono, d.imagenUrl, d.direccion,
      d.horario, d.latitud, d.longitud, req.usuario.id]);
  res.status(201).json(mapeos.sitio(await buscar(r.insertId)));
});

/** PUT /api/sitios/:id → solo el dueño; vuelve a PENDIENTE y sale del catálogo hasta revisarse. */
router.put('/:id', rol('EMPRENDEDOR'), async (req, res) => {
  const id = v.idDeRuta(req);
  const d = datosSitio(v.cuerpo(req));
  await propio(id, req.usuario);
  await consulta(
    `UPDATE sitios_turisticos
     SET nombre = ?, categoria = ?, municipio = ?, descripcion = ?, precio = ?, telefono = ?, imagen_url = ?,
         direccion = ?, horario = ?, latitud = ?, longitud = ?, estado = 'PENDIENTE', motivo_rechazo = NULL,
         fecha_actualizacion = NOW(6)
     WHERE id = ?`,
    [d.nombre, d.categoria, d.municipio, d.descripcion, d.precio, d.telefono, d.imagenUrl, d.direccion,
      d.horario, d.latitud, d.longitud, id]);
  await consulta('DELETE FROM favoritos WHERE sitio_id = ?', [id]);
  res.json(mapeos.sitio(await buscar(id)));
});

/** DELETE /api/sitios/:id → el emprendedor dueño o el administrador. */
router.delete('/:id', rol('EMPRENDEDOR', 'ADMIN'), async (req, res) => {
  const s = await buscar(v.idDeRuta(req));
  if (req.usuario.rol !== 'ADMIN' && req.usuario.id !== s.emprendedor_id)
    throw new ApiError(403, 'Solo el emprendedor dueño puede eliminar este servicio.');
  // MySQL elimina en cascada productos, pedidos y favoritos del sitio
  await consulta('DELETE FROM sitios_turisticos WHERE id = ?', [s.id]);
  res.status(204).end();
});

// ================= MODERACIÓN (ADMINISTRADOR) =================

/** PATCH /api/sitios/:id/estado → aprobar o rechazar (el rechazo exige motivo). */
router.patch('/:id/estado', rol('ADMIN'), async (req, res) => {
  const id = v.idDeRuta(req);
  const b = v.cuerpo(req);
  const estado = v.opcion(b.estado, ESTADOS, 'El estado es obligatorio.');
  const motivo = v.limpiar(v.texto(b.motivo, { max: 255, msgTam: 'El motivo no puede superar 255 caracteres.' }));
  await buscar(id);
  if (estado === 'RECHAZADO' && (motivo === null || motivo.length < 5))
    throw new ApiError(400, 'Escribe un motivo de rechazo (mínimo 5 caracteres).');

  await consulta('UPDATE sitios_turisticos SET estado = ?, motivo_rechazo = ?, fecha_actualizacion = NOW(6) WHERE id = ?',
    [estado, estado === 'RECHAZADO' ? motivo : null, id]);
  if (estado !== 'APROBADO') await consulta('DELETE FROM favoritos WHERE sitio_id = ?', [id]);
  res.json(mapeos.sitio(await buscar(id)));
});

module.exports = router;
