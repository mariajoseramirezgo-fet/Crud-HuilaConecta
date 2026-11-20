/**
 * "Cafetería Sin Fila": pedidos, pago simulado y resumen de pagos.
 *  - TURISTA: ordena y paga, consulta y cancela sus pedidos.
 *  - EMPRENDEDOR: ve los pedidos en tiempo real (SSE), avanza su estado y consulta el resumen de pagos.
 * Base: /api/pedidos
 */
'use strict';
const express = require('express');
const { consulta, uno, transaccion } = require('../db');
const { rol } = require('../middleware/sesion');
const { ApiError } = require('../utils/errores');
const v = require('../utils/validaciones');
const mapeos = require('../utils/mapeos');
const pasarela = require('../services/pagoSimulado');
const notificador = require('../services/pedidoNotificador');

const router = express.Router();

const ESTADOS = ['PENDIENTE', 'EN_PREPARACION', 'LISTO', 'ENTREGADO', 'CANCELADO'];
const METODOS = ['TARJETA', 'NEQUI', 'EFECTIVO'];
/** Transiciones permitidas para el emprendedor. */
const TRANSICIONES = {
  PENDIENTE: ['EN_PREPARACION', 'CANCELADO'],
  EN_PREPARACION: ['LISTO', 'CANCELADO'],
  LISTO: ['ENTREGADO', 'CANCELADO'],
  ENTREGADO: [],
  CANCELADO: []
};
const SELECT = `SELECT p.*, s.nombre AS sitio_nombre, s.emprendedor_id
                FROM pedidos p JOIN sitios_turisticos s ON s.id = p.sitio_id`;

// =====================================================================
//  Utilidades
// =====================================================================

/** Convierte filas de pedidos en JSON, cargando sus líneas (items) en una sola consulta. */
async function conItems(filas) {
  if (filas.length === 0) return [];
  const items = await consulta('SELECT * FROM pedido_items WHERE pedido_id IN (?) ORDER BY id', [filas.map(f => f.id)]);
  return filas.map(f => mapeos.pedido(f, items.filter(i => i.pedido_id === f.id)));
}

async function buscar(id) {
  const p = await uno(`${SELECT} WHERE p.id = ?`, [id]);
  if (!p) throw new ApiError(404, 'El pedido no existe.');
  return p;
}

const pedidoCompleto = async id => (await conItems([await buscar(id)]))[0];

/** Cancela el pedido; si ya estaba pagado, el pago queda REEMBOLSADO. */
const cancelarYReembolsar = p =>
  consulta(
    `UPDATE pedidos SET estado = 'CANCELADO',
            estado_pago = IF(estado_pago = 'PAGADO', 'REEMBOLSADO', estado_pago),
            fecha_actualizacion = NOW(6)
     WHERE id = ?`, [p.id]);

async function codigoUnico(conexion) {
  let codigo;
  do {
    codigo = 'HC-' + pasarela.codigo(6);
  } while (await uno('SELECT id FROM pedidos WHERE codigo = ?', [codigo], conexion));
  return codigo;
}

function datosPedido(b) {
  const sitioId = v.numero(b.sitioId, { obligatorio: 'Selecciona el restaurante.', entero: 'Selecciona el restaurante.' });
  if (!Array.isArray(b.items) || b.items.length === 0) throw new ApiError(400, 'Agrega al menos un producto.');
  if (b.items.length > 30) throw new ApiError(400, 'Máximo 30 productos distintos.');
  const items = b.items.map(i => {
    if (!i || typeof i !== 'object') throw new ApiError(400, v.FORMATO);
    return {
      productoId: v.numero(i.productoId, { obligatorio: 'Producto inválido.', entero: 'Producto inválido.' }),
      cantidad: v.numero(i.cantidad, {
        obligatorio: 'La cantidad mínima es 1.', entero: 'La cantidad mínima es 1.',
        min: 1, msgMin: 'La cantidad mínima es 1.', max: 20, msgMax: 'La cantidad máxima por producto es 20.'
      })
    };
  });
  const notas = v.limpiar(v.texto(b.notas, { max: 200, msgTam: 'Las notas admiten máximo 200 caracteres.' }));
  const recogerEnMinutos = v.numero(b.recogerEnMinutos, {
    obligatorio: 'Indica cuándo pasas a recoger.', entero: 'Indica cuándo pasas a recoger.',
    min: 10, msgMin: 'El tiempo mínimo de preparación es 10 minutos.', max: 120, msgMax: 'Puedes programar el pedido hasta 120 minutos.'
  });
  if (!b.pago || typeof b.pago !== 'object') throw new ApiError(400, 'Faltan los datos de pago.');
  v.opcion(b.pago.metodo, METODOS, 'Selecciona un método de pago.');
  return { sitioId, items, notas, recogerEnMinutos, pago: b.pago };
}

// =====================================================================
//  TURISTA
// =====================================================================

/**
 * POST /api/pedidos → crea el pedido:
 *  1. Valida que los productos pertenezcan al restaurante y estén disponibles.
 *  2. Calcula el total EN EL SERVIDOR (no se confía en precios enviados por el navegador).
 *  3. Procesa el pago simulado (si falla, no se guarda nada).
 *  4. Guarda pedido y líneas en una transacción y avisa en tiempo real al emprendedor.
 */
router.post('/', rol('TURISTA'), async (req, res) => {
  const d = datosPedido(v.cuerpo(req));
  const yo = req.usuario;

  const sitio = await uno(
    "SELECT id, emprendedor_id FROM sitios_turisticos WHERE id = ? AND estado = 'APROBADO' AND categoria = 'Sabores'",
    [d.sitioId]);
  if (!sitio) throw new ApiError(404, 'El restaurante no está disponible.');

  // Suma cantidades si el mismo producto llegó repetido
  const cantidades = new Map();
  for (const i of d.items) cantidades.set(i.productoId, (cantidades.get(i.productoId) || 0) + i.cantidad);

  const lineas = [];
  let total = 0;
  for (const [productoId, cantidad] of cantidades) {
    const p = await uno('SELECT id, sitio_id, nombre, precio, disponible FROM productos WHERE id = ?', [productoId]);
    if (!p) throw new ApiError(404, 'Uno de los productos ya no existe.');
    if (p.sitio_id !== sitio.id) throw new ApiError(400, 'Todos los productos deben ser del mismo restaurante.');
    if (!p.disponible) throw new ApiError(409, `"${p.nombre}" está agotado.`);
    if (cantidad > 20) throw new ApiError(400, 'La cantidad máxima por producto es 20.');
    const subtotal = p.precio * cantidad;
    lineas.push([p.id, p.nombre, p.precio, cantidad, subtotal]);
    total += subtotal;
  }

  // Pago simulado: lanza ApiError si se rechaza (todavía no se ha guardado nada)
  const pago = pasarela.procesar(d.pago);

  const pedidoId = await transaccion(async cx => {
    const codigo = await codigoUnico(cx);
    const r = await consulta(
      `INSERT INTO pedidos (codigo, turista_id, cliente_nombre, sitio_id, estado, metodo_pago, estado_pago, total,
                            referencia_pago, marca_tarjeta, ultimos4, notas, recoger_en)
       VALUES (?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?, NOW(6) + INTERVAL ? MINUTE)`,
      [codigo, yo.id, yo.nombre, sitio.id, d.pago.metodo, pago.estado, total, pago.referencia, pago.marca,
        pago.ultimos4, d.notas, d.recogerEnMinutos], cx);
    await consulta(
      'INSERT INTO pedido_items (pedido_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal) VALUES ?',
      [lineas.map(l => [r.insertId, ...l])], cx);
    return r.insertId;
  });

  const pedido = await pedidoCompleto(pedidoId);
  notificador.notificar(sitio.emprendedor_id, 'pedido', { id: pedido.id, codigo: pedido.codigo, nuevo: true });
  res.status(201).json(pedido);
});

/** GET /api/pedidos/mios → historial del turista. */
router.get('/mios', rol('TURISTA'), async (req, res) => {
  res.json(await conItems(await consulta(`${SELECT} WHERE p.turista_id = ? ORDER BY p.fecha DESC, p.id DESC`, [req.usuario.id])));
});

/** POST /api/pedidos/:id/cancelar → el turista cancela mientras siga PENDIENTE (se reembolsa). */
router.post('/:id/cancelar', rol('TURISTA'), async (req, res) => {
  const p = await buscar(v.idDeRuta(req));
  if (p.turista_id !== req.usuario.id) throw new ApiError(404, 'El pedido no existe.');
  if (p.estado !== 'PENDIENTE')
    throw new ApiError(409, 'El restaurante ya empezó a preparar tu pedido; no se puede cancelar.');
  await cancelarYReembolsar(p);
  notificador.notificar(p.emprendedor_id, 'pedido', { id: p.id, codigo: p.codigo, nuevo: false });
  res.json(await pedidoCompleto(p.id));
});

// =====================================================================
//  EMPRENDEDOR
// =====================================================================

/** GET /api/pedidos/emprendedor?activos=true → pedidos recibidos (activos o todos). */
router.get('/emprendedor', rol('EMPRENDEDOR'), async (req, res) => {
  const activos = v.opcionDeConsulta(req, 'activos', ['true', 'false']) === 'true';
  const filas = activos
    ? await consulta(
      `${SELECT} WHERE s.emprendedor_id = ? AND p.estado IN ('PENDIENTE', 'EN_PREPARACION', 'LISTO')
       ORDER BY p.fecha ASC, p.id ASC`, [req.usuario.id])
    : await consulta(`${SELECT} WHERE s.emprendedor_id = ? ORDER BY p.fecha DESC, p.id DESC`, [req.usuario.id]);
  res.json(await conItems(filas));
});

/**
 * GET /api/pedidos/emprendedor/resumen → resumen detallado de pagos:
 * ventas de hoy / 7 días / mes, totales por método, cobros pendientes en efectivo,
 * reembolsos, ticket promedio y los últimos movimientos.
 */
router.get('/emprendedor/resumen', rol('EMPRENDEDOR'), async (req, res) => {
  const todos = await consulta(`${SELECT} WHERE s.emprendedor_id = ? ORDER BY p.fecha DESC, p.id DESC`, [req.usuario.id]);
  // Límites de fecha calculados por MySQL (misma zona horaria que los pedidos), como texto "AAAA-MM-DD"
  const limites = await uno(
    `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy,
            DATE_FORMAT(CURDATE() - INTERVAL 6 DAY, '%Y-%m-%d') AS semana,
            DATE_FORMAT(CURDATE(), '%Y-%m-01') AS mes`);
  const desde = (p, limite) => p.fecha >= limite; // "2026-05-01 10:30…" >= "2026-05-01"

  let ventasHoy = 0, ventasSemana = 0, ventasMes = 0, totalPagado = 0, porCobrar = 0, reembolsado = 0;
  let pedidosHoy = 0, pagados = 0;
  const porMetodo = { TARJETA: 0, NEQUI: 0, EFECTIVO: 0 };
  const porSitio = {};

  for (const p of todos) {
    if (desde(p, limites.hoy)) pedidosHoy++;
    if (p.estado_pago === 'PAGADO') {
      pagados++;
      totalPagado += p.total;
      porMetodo[p.metodo_pago] += p.total;
      porSitio[p.sitio_nombre] = (porSitio[p.sitio_nombre] || 0) + p.total;
      if (desde(p, limites.hoy)) ventasHoy += p.total;
      if (desde(p, limites.semana)) ventasSemana += p.total;
      if (desde(p, limites.mes)) ventasMes += p.total;
    } else if (p.estado_pago === 'PENDIENTE') {
      if (p.estado !== 'CANCELADO') porCobrar += p.total;
    } else if (p.estado_pago === 'REEMBOLSADO') {
      reembolsado += p.total;
    }
  }

  const movimientos = todos
    .filter(p => p.estado_pago !== 'PENDIENTE' || p.estado !== 'CANCELADO')
    .slice(0, 25)
    .map(p => ({
      id: p.id,
      codigo: p.codigo,
      fecha: mapeos.fecha(p.fecha),
      cliente: p.cliente_nombre,
      sitio: p.sitio_nombre,
      metodo: p.metodo_pago,
      detalleMetodo: p.marca_tarjeta ? `${p.marca_tarjeta} ··${p.ultimos4}` : '',
      referencia: p.referencia_pago,
      estadoPago: p.estado_pago,
      estado: p.estado,
      total: p.total
    }));

  res.json({
    ventasHoy, ventasSemana, ventasMes, totalPagado,
    porCobrarEfectivo: porCobrar,
    reembolsado,
    pedidosHoy,
    pedidosTotales: todos.length,
    ticketPromedio: pagados === 0 ? 0 : Math.round(totalPagado / pagados),
    porMetodo, porSitio, movimientos
  });
});

/** GET /api/pedidos/emprendedor/stream → conexión SSE para recibir pedidos en tiempo real. */
router.get('/emprendedor/stream', rol('EMPRENDEDOR'), (req, res) => {
  notificador.suscribir(req.usuario.id, req, res);
});

/** PATCH /api/pedidos/:id/estado → avanza el estado. Al entregar un pedido en efectivo, queda PAGADO. */
router.patch('/:id/estado', rol('EMPRENDEDOR'), async (req, res) => {
  const id = v.idDeRuta(req);
  const estado = v.opcion(v.cuerpo(req).estado, ESTADOS, 'El estado es obligatorio.');
  const p = await buscar(id);
  if (p.emprendedor_id !== req.usuario.id) throw new ApiError(403, 'Este pedido no es de tus sitios.');
  if (!TRANSICIONES[p.estado].includes(estado))
    throw new ApiError(409, `No se puede pasar de ${p.estado} a ${estado}.`);

  if (estado === 'CANCELADO') {
    await cancelarYReembolsar(p);
  } else if (estado === 'ENTREGADO' && p.estado_pago === 'PENDIENTE') {
    // efectivo cobrado al entregar
    await consulta(
      "UPDATE pedidos SET estado = ?, estado_pago = 'PAGADO', referencia_pago = ?, fecha_actualizacion = NOW(6) WHERE id = ?",
      [estado, 'EFE-' + pasarela.codigo(8), id]);
  } else {
    await consulta('UPDATE pedidos SET estado = ?, fecha_actualizacion = NOW(6) WHERE id = ?', [estado, id]);
  }
  notificador.notificar(req.usuario.id, 'pedido', { id: p.id, codigo: p.codigo, nuevo: false });
  res.json(await pedidoCompleto(id));
});

module.exports = router;
