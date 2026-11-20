/**
 * Reglas de validación compartidas por todas las rutas.
 * El frontend (api.js → HC.Validar) aplica exactamente las mismas reglas, pero el
 * servidor las repite porque lo que llega del navegador nunca es de fiar.
 */
'use strict';
const { ApiError } = require('./errores');

const FORMATO = 'Los datos enviados no tienen el formato esperado.';

const RE = {
  /** Solo letras (con tildes y ñ), espacios, apóstrofo, punto y guion: 3 a 80. */
  NOMBRE: /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]{3,80}$/,
  /** Celular colombiano: exactamente 10 dígitos. */
  TELEFONO: /^[0-9]{10}$/,
  /** 8-64 caracteres con mayúscula, minúscula, número, símbolo y sin espacios. */
  PASSWORD: /^(?=.*[A-ZÁÉÍÓÚÑ])(?=.*[a-záéíóúñ])(?=.*\d)(?=.*[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ\s])\S{8,64}$/,
  MUNICIPIO: /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ .·,-]{3,80}$/,
  /** Imagen: vacía, URL externa http(s) o archivo propio /api/archivos/{id}. */
  IMAGEN: /^$|^https?:\/\/\S{4,490}$|^\/api\/archivos\/[0-9]{1,12}$/,
  CATEGORIA: /^(Experiencias|Hospedaje|Sabores|Transporte)$/,
  CORREO: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
};

const MSG = {
  NOMBRE: 'El nombre solo admite letras (3 a 80 caracteres).',
  TELEFONO: 'El teléfono debe tener exactamente 10 dígitos.',
  PASSWORD: 'La contraseña debe tener 8 a 64 caracteres, mayúscula, minúscula, número, símbolo y sin espacios.',
  IMAGEN: 'La imagen debe ser una URL http(s) o un archivo subido.'
};

const invalido = mensaje => { throw new ApiError(400, mensaje); };

/** El cuerpo de la petición debe ser un objeto JSON. */
function cuerpo(req) {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) invalido(FORMATO);
  return b;
}

/**
 * Valida un texto y lo devuelve (o null si no llegó).
 * @param {object} reglas { obligatorio: 'mensaje', patron: RegExp, msgPatron, min, max, msgTam }
 */
function texto(valor, reglas = {}) {
  if (valor === undefined || valor === null) {
    if (reglas.obligatorio) invalido(reglas.obligatorio);
    return null;
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') valor = String(valor);
  if (typeof valor !== 'string') invalido(FORMATO);
  if (reglas.obligatorio && valor.trim() === '') invalido(reglas.obligatorio);
  if (reglas.patron && !reglas.patron.test(valor)) invalido(reglas.msgPatron || 'Datos inválidos.');
  if (reglas.min !== undefined && valor.length < reglas.min) invalido(reglas.msgTam || 'Datos inválidos.');
  if (reglas.max !== undefined && valor.length > reglas.max) invalido(reglas.msgTam || 'Datos inválidos.');
  return valor;
}

/**
 * Valida un número (acepta 12 o "12") y lo devuelve (o null si no llegó).
 * @param {object} reglas { obligatorio, min, msgMin, max, msgMax, entero: 'mensaje' }
 */
function numero(valor, reglas = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (reglas.obligatorio) invalido(reglas.obligatorio);
    return null;
  }
  if (typeof valor === 'string' && /^-?\d+(\.\d+)?$/.test(valor.trim())) valor = Number(valor);
  if (typeof valor !== 'number' || !Number.isFinite(valor)) invalido(FORMATO);
  if (reglas.entero && !Number.isInteger(valor)) invalido(reglas.entero);
  if (reglas.min !== undefined && valor < reglas.min) invalido(reglas.msgMin || 'Datos inválidos.');
  if (reglas.max !== undefined && valor > reglas.max) invalido(reglas.msgMax || 'Datos inválidos.');
  return valor;
}

/** true, false o null (si no llegó). */
function booleano(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'boolean') invalido(FORMATO);
  return valor;
}

/** El valor debe ser una de las opciones (ej. un rol o un estado). */
function opcion(valor, opciones, msgObligatorio) {
  if (valor === undefined || valor === null || valor === '') {
    if (msgObligatorio) invalido(msgObligatorio);
    return null;
  }
  if (!opciones.includes(valor)) invalido(FORMATO);
  return valor;
}

/** Correo opcional u obligatorio (máx. 120). */
function correo(valor, msgObligatorio) {
  const c = texto(valor, { obligatorio: msgObligatorio, max: 120, msgTam: 'Correo inválido.' });
  if (c !== null && c !== '' && !RE.CORREO.test(c.trim())) invalido('Correo inválido.');
  return c;
}

/** Imagen opcional: URL http(s) o /api/archivos/{id}. Devuelve null si viene vacía. */
function imagen(valor) {
  return limpiar(texto(valor, { max: 500, msgTam: MSG.IMAGEN, patron: RE.IMAGEN, msgPatron: MSG.IMAGEN }));
}

/** Normaliza textos opcionales: "" o solo espacios → null. */
function limpiar(valor) {
  return valor === undefined || valor === null || String(valor).trim() === '' ? null : String(valor).trim();
}

/** Lee un id numérico de la URL (/api/sitios/:id). */
function idDeRuta(req, nombre = 'id') {
  const valor = req.params[nombre];
  if (!/^\d{1,18}$/.test(valor || '')) invalido(`El parámetro '${nombre}' no es válido.`);
  return Number(valor);
}

/** Lee un filtro opcional de la URL (?estado=APROBADO) que debe ser una de las opciones. */
function opcionDeConsulta(req, nombre, opciones) {
  const valor = req.query[nombre];
  if (valor === undefined || valor === '') return null;
  if (typeof valor !== 'string' || !opciones.includes(valor)) invalido(`El parámetro '${nombre}' no es válido.`);
  return valor;
}

module.exports = {
  RE, MSG, FORMATO, cuerpo, texto, numero, booleano, opcion, correo, imagen, limpiar, idDeRuta, opcionDeConsulta
};
