/**
 * Punto de entrada de HuilaConecta (Node.js + Express).
 * Ejecutar con:  npm start   (dentro de la carpeta backend/)
 *  - API REST:  http://localhost:8080/api
 *  - Frontend:  http://localhost:8080  (Express sirve los .html/.css/.js de la carpeta raíz del proyecto)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const config = require('./config');
const { pool } = require('./db');
const { cargarUsuario } = require('./middleware/sesion');
const { ApiError } = require('./utils/errores');
const { FORMATO } = require('./utils/validaciones');
const sesiones = require('./services/sesiones');
const notificador = require('./services/pedidoNotificador');

const app = express();
app.disable('x-powered-by');

// ---------------------------------------------------------------------
//  1. CORS: permite que Live Server (:5500, etc.) llame a la API enviando la cookie de sesión
// ---------------------------------------------------------------------
app.use('/api', (req, res, next) => {
  const origen = req.headers.origin;
  if (origen && config.origenPermitido.test(origen)) {
    res.set({
      'Access-Control-Allow-Origin': origen,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin'
    });
    if (req.method === 'OPTIONS') {
      res.set({
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Content-Type, Accept',
        'Access-Control-Max-Age': '1800'
      });
      return res.status(204).end();
    }
  }
  next();
});

// ---------------------------------------------------------------------
//  2. API REST
// ---------------------------------------------------------------------
app.use('/api', express.json({ limit: '100kb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', cargarUsuario); // deja en req.usuario al dueño de la cookie (o null)

app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios/me/fotos', require('./routes/galeria')); // antes que /api/usuarios
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/archivos', require('./routes/archivos'));
app.use('/api/sitios', require('./routes/sitios'));
app.use('/api/guias', require('./routes/guias'));
app.use('/api/comunidad', require('./routes/comunidad'));
app.use('/api/productos', require('./routes/productos'));
app.use('/api/pedidos', require('./routes/pedidos'));

app.use('/api', (req, res) => {
  res.status(404).json({ mensaje: 'La ruta solicitada no existe.', estado: 404 });
});

// ---------------------------------------------------------------------
//  3. Frontend: solo archivos de primer nivel .html/.css/.js de la carpeta raíz.
//     Las carpetas backend/ y database/ NO quedan expuestas.
// ---------------------------------------------------------------------
const hayFrontend = fs.existsSync(path.join(config.carpetaFrontend, 'index.html'));
if (hayFrontend) {
  const enviar = (res, archivo) => res.sendFile(archivo, {
    root: config.carpetaFrontend,
    headers: { 'Cache-Control': 'no-cache' }
  });
  app.get('/', (req, res) => enviar(res, 'index.html'));
  app.get(/^\/([A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:html|css|js))$/, (req, res) => enviar(res, req.params[0]));
}

// ---------------------------------------------------------------------
//  4. Errores: cualquier error se convierte en un JSON uniforme {"mensaje": "...", "estado": 400}.
//     El frontend muestra "mensaje" directamente al usuario.
// ---------------------------------------------------------------------
const ERRORES_CONEXION = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_DBACCESS_DENIED_ERROR'];

app.use((err, req, res, next) => {
  let estado = 500;
  let mensaje = 'Ocurrió un error inesperado en el servidor.';

  if (err instanceof ApiError) {
    estado = err.estado; mensaje = err.message;
  } else if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') { estado = 413; mensaje = 'La imagen supera el tamaño máximo de 2 MB.'; }
    else { estado = 400; mensaje = 'Selecciona un archivo de imagen.'; }
  } else if (err.type === 'entity.parse.failed' || err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    estado = 400; mensaje = FORMATO;
  } else if (err.type === 'entity.too.large') {
    estado = 413; mensaje = 'Los datos enviados son demasiado grandes.';
  } else if (ERRORES_CONEXION.includes(err.code)) {
    estado = 503; mensaje = 'El servidor no pudo conectarse a la base de datos MySQL.';
    console.error('[MySQL]', err.code, '-', err.message);
  } else if (err.sqlState && (err.sqlState.startsWith('23') || err.errno === 3819 || err.sqlState.startsWith('22'))) {
    // llaves duplicadas, llaves foráneas, CHECK o datos fuera de rango
    estado = 409; mensaje = 'La operación viola una restricción de la base de datos.';
    console.warn('[MySQL] Violación de integridad:', err.message);
  } else if (err.status === 404 || err.code === 'ENOENT') {
    estado = 404; mensaje = 'El recurso no existe.';
  } else {
    console.error(err); // la traza queda en la consola, nunca se envía al navegador
  }

  if (res.headersSent) return res.end();
  res.status(estado).json({ mensaje, estado });
});

// ---------------------------------------------------------------------
//  5. Arranque
// ---------------------------------------------------------------------
async function iniciar() {
  try {
    await pool.query('SELECT 1 FROM usuarios LIMIT 1');
    console.log(`✔ Conectado a MySQL: ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`);
  } catch (e) {
    console.error('✖ No se pudo usar la base de datos MySQL:', e.code || '', e.message);
    console.error('  1) Verifica que MySQL esté encendido.');
    console.error('  2) Ejecuta database/schema.sql en MySQL Workbench.');
    console.error('  3) Revisa usuario y contraseña en backend/.env (copia .env.example si no existe).');
  }

  sesiones.programarLimpieza();
  notificador.programarLatido();

  const servidor = app.listen(config.puerto, () => {
    console.log(`✔ API disponible en http://localhost:${config.puerto}/api`);
    if (hayFrontend) console.log(`✔ Frontend disponible en http://localhost:${config.puerto}`);
    else console.warn(`⚠ No se encontró index.html en ${config.carpetaFrontend}. Ajusta FRONTEND_DIR en backend/.env o abre el frontend con Live Server.`);
  });
  servidor.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error(`✖ El puerto ${config.puerto} ya está en uso. Cierra el otro programa o cambia PORT en backend/.env.`);
    else console.error(e);
    process.exit(1);
  });
}

iniciar();
