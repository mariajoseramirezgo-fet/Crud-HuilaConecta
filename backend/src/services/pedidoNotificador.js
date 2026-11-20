/**
 * Tiempo real para "Cafetería Sin Fila" con Server-Sent Events (SSE).
 * El panel del emprendedor abre una conexión (EventSource) y recibe un aviso cada vez que
 * entra un pedido nuevo o cambia uno existente; entonces vuelve a consultar la lista.
 */
'use strict';

/** Conexiones abiertas por emprendedor: Map<emprendedorId, Set<res>>. */
const conexiones = new Map();

function enviar(res, tipo, datos) {
  try {
    res.write(`event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`);
  } catch (e) {
    res.end();
  }
}

/** Registra una nueva conexión del emprendedor indicado y la mantiene abierta. */
function suscribir(emprendedorId, req, res) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  if (!conexiones.has(emprendedorId)) conexiones.set(emprendedorId, new Set());
  const lista = conexiones.get(emprendedorId);
  lista.add(res);
  req.on('close', () => {
    lista.delete(res);
    if (lista.size === 0) conexiones.delete(emprendedorId);
  });
  enviar(res, 'conectado', { ok: true });
}

/** Avisa al emprendedor. Llamar DESPUÉS de guardar en MySQL para que el panel lea datos ya guardados. */
function notificar(emprendedorId, tipo, datos) {
  const lista = conexiones.get(emprendedorId);
  if (lista) lista.forEach(res => enviar(res, tipo, datos));
}

/** "Latido" cada 25 s para que proxies y navegadores no cierren la conexión inactiva. */
function programarLatido() {
  setInterval(() => {
    conexiones.forEach(lista => lista.forEach(res => enviar(res, 'latido', {})));
  }, 25000).unref();
}

module.exports = { suscribir, notificar, programarLatido };
