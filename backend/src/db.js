/**
 * Acceso a MySQL con un "pool" de conexiones (mysql2).
 *  - Todas las consultas usan parámetros (?) → sin inyección SQL.
 *  - Las fechas se leen como texto y los DECIMAL como números, para enviar al
 *    frontend el mismo JSON de siempre.
 */
'use strict';
const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  decimalNumbers: true
});

// Cada conexión nueva trabaja en la hora de Colombia: NOW() devuelve la hora local.
pool.pool.on('connection', conexion => {
  conexion.query('SET time_zone = ?', [config.db.zonaHoraria]);
});

/** Ejecuta una consulta y devuelve las filas (o el resultado de un INSERT/UPDATE/DELETE). */
async function consulta(sql, parametros = [], conexion = pool) {
  const [filas] = await conexion.query(sql, parametros);
  return filas;
}

/** Devuelve solo la primera fila (o null). */
async function uno(sql, parametros = [], conexion = pool) {
  const filas = await consulta(sql, parametros, conexion);
  return filas[0] || null;
}

/**
 * Ejecuta varias consultas como una sola operación: si algo falla se deshace todo (ROLLBACK).
 * @param {(conexion) => Promise<any>} trabajo
 */
async function transaccion(trabajo) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (e) {
    await conexion.rollback();
    throw e;
  } finally {
    conexion.release();
  }
}

module.exports = { pool, consulta, uno, transaccion };
