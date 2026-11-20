/**
 * Pasarela de pago SIMULADA (proyecto académico: no se conecta a ningún banco real).
 *
 * Reglas de prueba:
 *  - Tarjeta: 16 dígitos válidos según el algoritmo de Luhn, fecha MM/AA vigente y CVV de 3 dígitos.
 *      · 4242 4242 4242 4242 → aprobada
 *      · 4000 0000 0000 0002 → rechazada por el "banco" (para probar el error)
 *  - Nequi: celular de 10 dígitos que empiece por 3 → aprobado.
 *  - Efectivo: queda PENDIENTE y se cobra al entregar el pedido.
 *
 * Nunca se guarda el número completo ni el CVV: solo la marca y los últimos 4 dígitos.
 */
'use strict';
const crypto = require('crypto');
const { ApiError } = require('../utils/errores');

const TARJETA_RECHAZADA = '4000000000000002';
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Código aleatorio legible, usado para referencias de pago y códigos de pedido. */
function codigo(largo) {
  let c = '';
  for (let i = 0; i < largo; i++) c += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return c;
}

const referencia = () => 'SIM-' + codigo(8);

function marca(numero) {
  if (numero.startsWith('4')) return 'VISA';
  if (/^5[1-5]/.test(numero) || /^2[2-7]/.test(numero)) return 'MASTERCARD';
  if (numero.startsWith('3')) return 'AMEX';
  return 'TARJETA';
}

/** Algoritmo de Luhn: detecta errores de digitación en números de tarjeta. */
function luhn(numero) {
  let suma = 0;
  let doble = false;
  for (let i = numero.length - 1; i >= 0; i--) {
    let d = Number(numero[i]);
    if (doble) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
    doble = !doble;
  }
  return suma % 10 === 0;
}

const comoTexto = v => (typeof v === 'string' ? v : '');

function tarjeta(d) {
  const numero = comoTexto(d.numeroTarjeta).replace(/\s/g, '');
  if (!/^[0-9]{16}$/.test(numero) || !luhn(numero))
    throw new ApiError(400, 'El número de tarjeta no es válido.');
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'-]{3,60}$/.test(comoTexto(d.titular).trim()))
    throw new ApiError(400, 'Escribe el nombre del titular como aparece en la tarjeta.');
  const vencimiento = comoTexto(d.vencimiento);
  if (!/^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(vencimiento))
    throw new ApiError(400, 'La fecha de vencimiento debe tener el formato MM/AA.');
  const mes = Number(vencimiento.slice(0, 2));
  const anio = 2000 + Number(vencimiento.slice(3));
  const hoy = new Date();
  if (anio < hoy.getFullYear() || (anio === hoy.getFullYear() && mes < hoy.getMonth() + 1))
    throw new ApiError(400, 'La tarjeta está vencida.');
  if (!/^[0-9]{3}$/.test(comoTexto(d.cvv)))
    throw new ApiError(400, 'El CVV debe tener 3 dígitos.');
  if (numero === TARJETA_RECHAZADA)
    throw new ApiError(402, 'Pago rechazado por el banco (simulación). Prueba con otra tarjeta.');
  return { estado: 'PAGADO', referencia: referencia(), marca: marca(numero), ultimos4: numero.slice(12) };
}

function nequi(d) {
  const telefono = comoTexto(d.telefonoNequi);
  if (!/^3[0-9]{9}$/.test(telefono))
    throw new ApiError(400, 'El celular Nequi debe tener 10 dígitos y empezar por 3.');
  return { estado: 'PAGADO', referencia: referencia(), marca: 'NEQUI', ultimos4: telefono.slice(6) };
}

/**
 * Procesa el pago. Devuelve lo único que se guarda en la base de datos:
 * { estado, referencia, marca, ultimos4 }. Lanza ApiError si se rechaza.
 */
function procesar(datos) {
  if (!datos || !datos.metodo) throw new ApiError(400, 'Selecciona un método de pago.');
  switch (datos.metodo) {
    case 'TARJETA': return tarjeta(datos);
    case 'NEQUI': return nequi(datos);
    case 'EFECTIVO': return { estado: 'PENDIENTE', referencia: null, marca: null, ultimos4: null };
    default: throw new ApiError(400, 'Selecciona un método de pago.');
  }
}

module.exports = { procesar, codigo };
