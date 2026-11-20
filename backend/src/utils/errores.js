/** Error de negocio con su código HTTP (400, 401, 403, 404, 409, 402...). */
'use strict';

class ApiError extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

module.exports = { ApiError };
