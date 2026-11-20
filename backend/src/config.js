/**
 * Configuración del backend. Los valores se leen del archivo backend/.env
 * (ver .env.example). Nunca escribas contraseñas directamente en el código.
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const RAIZ_BACKEND = path.join(__dirname, '..');

module.exports = {
  puerto: Number(process.env.PORT) || 8080,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'huilaconecta_db',
    zonaHoraria: process.env.DB_TIMEZONE || '-05:00'
  },
  /** Carpeta del frontend (index.html, styles.css...). Relativa a backend/. */
  carpetaFrontend: path.resolve(RAIZ_BACKEND, process.env.FRONTEND_DIR || '..'),
  /** Orígenes de desarrollo aceptados por CORS (Live Server, etc.). En producción pon tu dominio. */
  origenPermitido: /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
};
