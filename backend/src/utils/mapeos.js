/**
 * Convierte las filas de MySQL (snake_case) en los objetos JSON que usa el frontend (camelCase).
 * Aquí se decide qué columnas salen: por ejemplo, password_hash NUNCA se envía.
 */
'use strict';

/** "2026-05-01 10:30:00.000000" → "2026-05-01T10:30:00.000000" (formato que entiende new Date()). */
const fecha = v => (v ? String(v).replace(' ', 'T') : null);
const bool = v => v === 1 || v === true;

const usuario = f => f && {
  id: f.id,
  nombre: f.nombre,
  correo: f.correo,
  telefono: f.telefono,
  rol: f.rol,
  activo: bool(f.activo),
  fotoUrl: f.foto_url,
  tema: f.tema,
  fechaRegistro: fecha(f.fecha_registro)
};

/** Requiere la columna extra emprendedor_nombre (JOIN con usuarios). */
const sitio = f => f && {
  id: f.id,
  nombre: f.nombre,
  categoria: f.categoria,
  municipio: f.municipio,
  descripcion: f.descripcion,
  precio: f.precio,
  telefono: f.telefono,
  imagenUrl: f.imagen_url,
  direccion: f.direccion,
  horario: f.horario,
  latitud: f.latitud,
  longitud: f.longitud,
  estado: f.estado,
  motivoRechazo: f.motivo_rechazo,
  fechaCreacion: fecha(f.fecha_creacion),
  fechaActualizacion: fecha(f.fecha_actualizacion),
  emprendedorId: f.emprendedor_id,
  emprendedorNombre: f.emprendedor_nombre
};

const guia = f => f && {
  id: f.id,
  nombre: f.nombre,
  fotoUrl: f.foto_url,
  especialidad: f.especialidad,
  idiomas: f.idiomas,
  municipios: f.municipios,
  experienciaAnios: f.experiencia_anios,
  telefono: f.telefono,
  correo: f.correo,
  rnt: f.rnt,
  tarifaDia: f.tarifa_dia,
  calificacion: f.calificacion,
  descripcion: f.descripcion,
  activo: bool(f.activo),
  fechaRegistro: fecha(f.fecha_registro)
};

const foto = f => f && {
  id: f.id,
  url: f.url,
  descripcion: f.descripcion,
  fechaSubida: fecha(f.fecha_subida)
};

/** Requiere la columna extra sitio_nombre (JOIN con sitios_turisticos). */
const producto = f => f && {
  id: f.id,
  nombre: f.nombre,
  descripcion: f.descripcion,
  precio: f.precio,
  imagenUrl: f.imagen_url,
  disponible: bool(f.disponible),
  fechaCreacion: fecha(f.fecha_creacion),
  sitioId: f.sitio_id,
  sitioNombre: f.sitio_nombre
};

const pedidoItem = f => ({
  id: f.id,
  productoId: f.producto_id,
  nombreProducto: f.nombre_producto,
  precioUnitario: f.precio_unitario,
  cantidad: f.cantidad,
  subtotal: f.subtotal
});

/** Requiere la columna extra sitio_nombre. Los items se cargan aparte. */
const pedido = (f, items = []) => f && {
  id: f.id,
  codigo: f.codigo,
  clienteNombre: f.cliente_nombre,
  estado: f.estado,
  metodoPago: f.metodo_pago,
  estadoPago: f.estado_pago,
  total: f.total,
  referenciaPago: f.referencia_pago,
  marcaTarjeta: f.marca_tarjeta,
  ultimos4: f.ultimos4,
  notas: f.notas,
  recogerEn: fecha(f.recoger_en),
  fecha: fecha(f.fecha),
  fechaActualizacion: fecha(f.fecha_actualizacion),
  items: items.map(pedidoItem),
  sitioId: f.sitio_id,
  sitioNombre: f.sitio_nombre,
  turistaId: f.turista_id
};

module.exports = { fecha, bool, usuario, sitio, guia, foto, producto, pedido };
