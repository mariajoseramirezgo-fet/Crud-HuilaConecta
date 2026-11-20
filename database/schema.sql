-- ==============================================================
--  HuilaConecta · Script de base de datos (MySQL 8 / MySQL Workbench)
--  Esquema completo + datos de prueba. Lo usa el backend Node.js.
--
--  CÓMO EJECUTARLO EN MYSQL WORKBENCH
--    1. Abre tu conexión local (localhost:3306).
--    2. File → Open SQL Script… → selecciona este archivo.
--    3. Pulsa el rayo ⚡ (Execute) para ejecutar TODO el script.
--    4. Clic derecho en SCHEMAS → Refresh All: aparece "huilaconecta_db".
--
--  ⚠ Ejecutarlo de nuevo BORRA las tablas y vuelve a los datos iniciales.
--
--  CUENTAS DE PRUEBA (las contraseñas se guardan como hash BCrypt)
--    admin@huilaconecta.co         Admin1234*    (ADMIN)
--    emprendedor@huilaconecta.co   Empre123*     (EMPRENDEDOR)
--    valentina@huilaconecta.co     Empre123*     (EMPRENDEDOR)
--    turista@huilaconecta.co       Turista123*   (TURISTA)
-- ==============================================================

-- Garantiza que tildes, ñ y emojis se guarden bien sin importar el cliente que ejecute el script
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS huilaconecta_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE huilaconecta_db;

-- Se eliminan en orden inverso a las llaves foráneas
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS pedido_items;
DROP TABLE IF EXISTS pedidos;
DROP TABLE IF EXISTS productos;
DROP TABLE IF EXISTS publicacion_likes;
DROP TABLE IF EXISTS comentarios;
DROP TABLE IF EXISTS publicaciones;
DROP TABLE IF EXISTS fotos_usuario;
DROP TABLE IF EXISTS guias;
DROP TABLE IF EXISTS favoritos;
DROP TABLE IF EXISTS sitios_turisticos;
DROP TABLE IF EXISTS archivos;
DROP TABLE IF EXISTS sesiones;
DROP TABLE IF EXISTS usuarios;
SET FOREIGN_KEY_CHECKS = 1;

-- --------------------------------------------------------------
-- usuarios: los 3 roles comparten tabla y se distinguen por "rol"
-- --------------------------------------------------------------
CREATE TABLE usuarios (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  nombre          VARCHAR(80)   NOT NULL,
  correo          VARCHAR(120)  NOT NULL,
  telefono        VARCHAR(10)   NOT NULL,
  password_hash   VARCHAR(100)  NOT NULL COMMENT 'Hash BCrypt, nunca texto plano',
  rol             VARCHAR(20)   NOT NULL,
  activo          BOOLEAN       NOT NULL DEFAULT TRUE,
  foto_url        VARCHAR(500)  NULL COMMENT 'URL externa o /api/archivos/{id}',
  tema            VARCHAR(10)   NOT NULL DEFAULT 'light',
  fecha_registro  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT uq_usuarios_correo UNIQUE (correo),
  CONSTRAINT chk_usuarios_rol CHECK (rol IN ('ADMIN', 'EMPRENDEDOR', 'TURISTA')),
  CONSTRAINT chk_usuarios_telefono CHECK (telefono REGEXP '^[0-9]{10}$'),
  CONSTRAINT chk_usuarios_tema CHECK (tema IN ('light', 'dark'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- sesiones: reemplaza a localStorage/sessionStorage.
-- El navegador guarda el token en una cookie HttpOnly; aquí solo su hash SHA-256.
-- --------------------------------------------------------------
CREATE TABLE sesiones (
  token_hash  CHAR(64)     NOT NULL,
  usuario_id  BIGINT       NOT NULL,
  creada      DATETIME(6)  NOT NULL,
  expira      DATETIME(6)  NOT NULL,
  ultimo_uso  DATETIME(6)  NOT NULL,
  PRIMARY KEY (token_hash),
  CONSTRAINT fk_sesiones_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE CASCADE,
  INDEX idx_sesiones_expira (expira)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- archivos: imágenes subidas desde el PC (bytes en la BD, máx. 2 MB)
-- --------------------------------------------------------------
CREATE TABLE archivos (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  nombre         VARCHAR(150)  NOT NULL,
  tipo_mime      VARCHAR(40)   NOT NULL,
  tamano         BIGINT        NOT NULL,
  datos          MEDIUMBLOB    NOT NULL,
  propietario_id BIGINT        NULL,
  fecha_subida   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT fk_archivos_propietario FOREIGN KEY (propietario_id)
    REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT chk_archivos_tipo CHECK (tipo_mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  CONSTRAINT chk_archivos_tamano CHECK (tamano BETWEEN 1 AND 2097152)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- sitios_turisticos: N:1 con usuarios (emprendedor)
-- --------------------------------------------------------------
CREATE TABLE sitios_turisticos (
  id                   BIGINT         NOT NULL AUTO_INCREMENT,
  nombre               VARCHAR(100)   NOT NULL,
  categoria            VARCHAR(30)    NOT NULL,
  municipio            VARCHAR(80)    NOT NULL,
  descripcion          VARCHAR(1000)  NOT NULL,
  precio               DECIMAL(12,0)  NOT NULL,
  telefono             VARCHAR(10)    NOT NULL,
  imagen_url           VARCHAR(500)   NULL,
  direccion            VARCHAR(160)   NULL,
  horario              VARCHAR(120)   NULL,
  latitud              DECIMAL(9,6)   NULL,
  longitud             DECIMAL(9,6)   NULL,
  estado               VARCHAR(20)    NOT NULL DEFAULT 'PENDIENTE',
  motivo_rechazo       VARCHAR(255)   NULL,
  emprendedor_id       BIGINT         NOT NULL,
  fecha_creacion       DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  fecha_actualizacion  DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT fk_sitios_emprendedor FOREIGN KEY (emprendedor_id)
    REFERENCES usuarios (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_sitios_categoria CHECK (categoria IN ('Experiencias', 'Hospedaje', 'Sabores', 'Transporte')),
  CONSTRAINT chk_sitios_estado CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  CONSTRAINT chk_sitios_precio CHECK (precio >= 1000),
  CONSTRAINT chk_sitios_telefono CHECK (telefono REGEXP '^[0-9]{10}$'),
  CONSTRAINT chk_sitios_latitud CHECK (latitud IS NULL OR latitud BETWEEN 1 AND 4),
  CONSTRAINT chk_sitios_longitud CHECK (longitud IS NULL OR longitud BETWEEN -77 AND -74),
  INDEX idx_sitios_estado_categoria (estado, categoria),
  INDEX idx_sitios_emprendedor (emprendedor_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- favoritos: N:M turistas ↔ sitios
-- --------------------------------------------------------------
CREATE TABLE favoritos (
  usuario_id  BIGINT NOT NULL,
  sitio_id    BIGINT NOT NULL,
  PRIMARY KEY (usuario_id, sitio_id),
  CONSTRAINT fk_favoritos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT fk_favoritos_sitio FOREIGN KEY (sitio_id) REFERENCES sitios_turisticos (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- guias: guías turísticos de la región (CRUD del administrador)
-- --------------------------------------------------------------
CREATE TABLE guias (
  id                 BIGINT         NOT NULL AUTO_INCREMENT,
  nombre             VARCHAR(80)    NOT NULL,
  foto_url           VARCHAR(500)   NULL,
  especialidad       VARCHAR(100)   NOT NULL,
  idiomas            VARCHAR(120)   NOT NULL,
  municipios         VARCHAR(200)   NOT NULL,
  experiencia_anios  INT            NOT NULL,
  telefono           VARCHAR(10)    NOT NULL,
  correo             VARCHAR(120)   NULL,
  rnt                VARCHAR(10)    NULL COMMENT 'Registro Nacional de Turismo',
  tarifa_dia         DECIMAL(12,0)  NOT NULL,
  calificacion       DECIMAL(2,1)   NOT NULL,
  descripcion        VARCHAR(1000)  NOT NULL,
  activo             BOOLEAN        NOT NULL DEFAULT TRUE,
  fecha_registro     DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT chk_guias_telefono CHECK (telefono REGEXP '^[0-9]{10}$'),
  CONSTRAINT chk_guias_experiencia CHECK (experiencia_anios BETWEEN 0 AND 60),
  CONSTRAINT chk_guias_calificacion CHECK (calificacion BETWEEN 1.0 AND 5.0),
  CONSTRAINT chk_guias_tarifa CHECK (tarifa_dia >= 10000)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- fotos_usuario: galería personal del turista
-- --------------------------------------------------------------
CREATE TABLE fotos_usuario (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  usuario_id    BIGINT        NOT NULL,
  url           VARCHAR(500)  NOT NULL,
  descripcion   VARCHAR(200)  NULL,
  fecha_subida  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT fk_fotos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  INDEX idx_fotos_usuario (usuario_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- Comunidad: publicaciones, comentarios y "Me gusta"
-- --------------------------------------------------------------
CREATE TABLE publicaciones (
  id                 BIGINT         NOT NULL AUTO_INCREMENT,
  autor_id           BIGINT         NOT NULL,
  contenido          VARCHAR(1000)  NOT NULL,
  imagen_url         VARCHAR(500)   NULL,
  estado             VARCHAR(10)    NOT NULL DEFAULT 'VISIBLE',
  motivo_moderacion  VARCHAR(255)   NULL,
  fecha              DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  fecha_edicion      DATETIME(6)    NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_publicaciones_autor FOREIGN KEY (autor_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT chk_publicaciones_estado CHECK (estado IN ('VISIBLE', 'OCULTA')),
  INDEX idx_publicaciones_estado_fecha (estado, fecha)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE comentarios (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  publicacion_id  BIGINT        NOT NULL,
  autor_id        BIGINT        NOT NULL,
  contenido       VARCHAR(500)  NOT NULL,
  estado          VARCHAR(10)   NOT NULL DEFAULT 'VISIBLE',
  fecha           DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT fk_comentarios_publicacion FOREIGN KEY (publicacion_id) REFERENCES publicaciones (id) ON DELETE CASCADE,
  CONSTRAINT fk_comentarios_autor FOREIGN KEY (autor_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT chk_comentarios_estado CHECK (estado IN ('VISIBLE', 'OCULTA'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- PK compuesta: un usuario solo puede dar un "Me gusta" por publicación
CREATE TABLE publicacion_likes (
  publicacion_id  BIGINT NOT NULL,
  usuario_id      BIGINT NOT NULL,
  PRIMARY KEY (publicacion_id, usuario_id),
  CONSTRAINT fk_likes_publicacion FOREIGN KEY (publicacion_id) REFERENCES publicaciones (id) ON DELETE CASCADE,
  CONSTRAINT fk_likes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- Cafetería Sin Fila: menú, pedidos y líneas de pedido
-- --------------------------------------------------------------
CREATE TABLE productos (
  id              BIGINT         NOT NULL AUTO_INCREMENT,
  sitio_id        BIGINT         NOT NULL,
  nombre          VARCHAR(80)    NOT NULL,
  descripcion     VARCHAR(300)   NULL,
  precio          DECIMAL(10,0)  NOT NULL,
  imagen_url      VARCHAR(500)   NULL,
  disponible      BOOLEAN        NOT NULL DEFAULT TRUE,
  fecha_creacion  DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT fk_productos_sitio FOREIGN KEY (sitio_id) REFERENCES sitios_turisticos (id) ON DELETE CASCADE,
  CONSTRAINT chk_productos_precio CHECK (precio BETWEEN 500 AND 1000000)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE pedidos (
  id                   BIGINT         NOT NULL AUTO_INCREMENT,
  codigo               VARCHAR(12)    NOT NULL,
  turista_id           BIGINT         NULL COMMENT 'NULL si el turista eliminó su cuenta',
  cliente_nombre       VARCHAR(80)    NOT NULL,
  sitio_id             BIGINT         NOT NULL,
  estado               VARCHAR(20)    NOT NULL DEFAULT 'PENDIENTE',
  metodo_pago          VARCHAR(10)    NOT NULL,
  estado_pago          VARCHAR(12)    NOT NULL,
  total                DECIMAL(12,0)  NOT NULL,
  referencia_pago      VARCHAR(20)    NULL,
  marca_tarjeta        VARCHAR(15)    NULL,
  ultimos4             CHAR(4)        NULL COMMENT 'Nunca se guarda el número completo ni el CVV',
  notas                VARCHAR(200)   NULL,
  recoger_en           DATETIME(6)    NOT NULL,
  fecha                DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  fecha_actualizacion  DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT uq_pedidos_codigo UNIQUE (codigo),
  CONSTRAINT fk_pedidos_turista FOREIGN KEY (turista_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_pedidos_sitio FOREIGN KEY (sitio_id) REFERENCES sitios_turisticos (id) ON DELETE CASCADE,
  CONSTRAINT chk_pedidos_estado CHECK (estado IN ('PENDIENTE', 'EN_PREPARACION', 'LISTO', 'ENTREGADO', 'CANCELADO')),
  CONSTRAINT chk_pedidos_metodo CHECK (metodo_pago IN ('TARJETA', 'NEQUI', 'EFECTIVO')),
  CONSTRAINT chk_pedidos_estado_pago CHECK (estado_pago IN ('PAGADO', 'PENDIENTE', 'REEMBOLSADO')),
  CONSTRAINT chk_pedidos_total CHECK (total > 0),
  INDEX idx_pedidos_sitio_estado (sitio_id, estado),
  INDEX idx_pedidos_turista (turista_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE pedido_items (
  id               BIGINT         NOT NULL AUTO_INCREMENT,
  pedido_id        BIGINT         NOT NULL,
  producto_id      BIGINT         NULL COMMENT 'NULL si el producto se eliminó del menú',
  nombre_producto  VARCHAR(80)    NOT NULL,
  precio_unitario  DECIMAL(10,0)  NOT NULL,
  cantidad         INT            NOT NULL,
  subtotal         DECIMAL(12,0)  NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_items_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
  CONSTRAINT fk_items_producto FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE SET NULL,
  CONSTRAINT chk_items_cantidad CHECK (cantidad BETWEEN 1 AND 20)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ==============================================================
--  DATOS SEMILLA
--  Las contraseñas de prueba están arriba y en el README (hash BCrypt, factor 10).
--  Cámbialas antes de publicar el proyecto.
-- ==============================================================
INSERT INTO usuarios (id, nombre, correo, telefono, password_hash, rol, activo, foto_url) VALUES
  (1, 'Administrador HuilaConecta', 'admin@huilaconecta.co',       '3001234567', '$2b$10$6YkegIcIzGN/ippi6tt1nuRjjH.1jS13JqVAKHtm8xUmcevHfRdLG', 'ADMIN',       TRUE, NULL),
  (2, 'Julián Losada',              'emprendedor@huilaconecta.co', '3109876543', '$2a$10$lr3Az.AbnyI53Sk1euxMXudCkYZpCMOdi9czbOTL66i3hIsPljRKK', 'EMPRENDEDOR', TRUE, 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80'),
  (3, 'Valentina Polanía',          'valentina@huilaconecta.co',   '3205551234', '$2a$10$lr3Az.AbnyI53Sk1euxMXudCkYZpCMOdi9czbOTL66i3hIsPljRKK', 'EMPRENDEDOR', TRUE, 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80'),
  (4, 'Camila Restrepo',            'turista@huilaconecta.co',     '3152223344', '$2a$10$RGh79CrCgxaNUZDVbRoQTO6AlitcmTxzT2pSEbgfc0fneoUwSkz3u', 'TURISTA',     TRUE, NULL);

INSERT INTO sitios_turisticos (id, nombre, categoria, municipio, descripcion, precio, telefono, imagen_url, direccion, horario, latitud, longitud, estado, motivo_rechazo, emprendedor_id) VALUES
  (1, 'Desierto de la Tatacoa', 'Experiencias', 'Villavieja',
   'Caminata guiada por los laberintos rojos y grises del desierto y observación astronómica al anochecer.',
   185000, '3109876543', 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=900&q=80',
   'Observatorio Astronómico, vía Villavieja', 'Todos los días · 3:00 p. m. a 10:00 p. m.', 3.233600, -75.168600, 'APROBADO', NULL, 2),
  (2, 'San Agustín ancestral', 'Experiencias', 'San Agustín',
   'Recorrido por paisajes verdes y el legado de la cultura agustiniana con guía local. Entrada al parque no incluida.',
   160000, '3205551234', 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=900&q=80',
   'Parque Arqueológico de San Agustín', 'Martes a domingo · 8:00 a. m. a 4:00 p. m.', 1.888000, -76.296000, 'APROBADO', NULL, 3),
  (3, 'Refugio entre montañas', 'Hospedaje', 'Pitalito',
   'Cabaña para dos personas con desayuno típico incluido y vista a las montañas del sur del Huila.',
   240000, '3205551234', 'https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=900&q=80',
   'Vereda Bruselas, Pitalito', 'Check-in 3:00 p. m. · Check-out 12:00 m.', 1.853000, -76.051000, 'APROBADO', NULL, 3),
  (4, 'Asado huilense La Mesa', 'Sabores', 'Neiva',
   'Asado huilense tradicional con arepa, yuca y ají de la casa. Pide con anticipación y recoge sin fila.',
   56000, '3109876543', 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80',
   'Calle 8 # 5-32, Centro, Neiva', 'Lunes a sábado · 11:00 a. m. a 9:00 p. m.', 2.927300, -75.281900, 'APROBADO', NULL, 2),
  (5, 'Café de origen Huila', 'Sabores', 'Neiva',
   'Café filtrado de fincas de la región, con cata guiada para grupos pequeños de estudiantes y viajeros.',
   6000, '3109876543', 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=900&q=80',
   'Avenida Pastrana # 1-20, cerca a la USCO, Neiva', 'Lunes a viernes · 7:00 a. m. a 7:00 p. m.', 2.938500, -75.289500, 'APROBADO', NULL, 2),
  (6, 'Ruta en chiva', 'Transporte', 'Neiva',
   'Transporte turístico en chiva entre Neiva y Villavieja. Confirma horario y disponibilidad con el prestador.',
   45000, '3109876543', 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=900&q=80',
   'Terminal de Transportes de Neiva', 'Salidas 7:00 a. m. y 1:00 p. m.', 2.933700, -75.278900, 'APROBADO', NULL, 2),
  (7, 'Termales de Rivera', 'Experiencias', 'Rivera',
   'Pasadía en aguas termales a 30 minutos de Neiva, con almuerzo típico y transporte opcional desde la ciudad.',
   95000, '3205551234', 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=900&q=80',
   'Termales de Rivera, vía Rivera', 'Todos los días · 8:00 a. m. a 6:00 p. m.', 2.776000, -75.255000, 'PENDIENTE', NULL, 3),
  (8, 'Glamping río Magdalena', 'Hospedaje', 'Garzón',
   'Noche de glamping a orillas del río Magdalena con fogata, cena campesina y caminata al amanecer.',
   210000, '3109876543', 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=900&q=80',
   NULL, NULL, NULL, NULL, 'PENDIENTE', NULL, 2),
  (9, 'Tour nocturno exprés', 'Transporte', 'Neiva',
   'Recorrido en moto por la ciudad sin información de seguridad ni pólizas para pasajeros.',
   30000, '3109876543', NULL, NULL, NULL, NULL, NULL, 'RECHAZADO', 'Falta información de seguridad y pólizas para pasajeros.', 2),
  (10, 'Achiras y bizcochos de la Abuela', 'Sabores', 'Neiva',
   'Panadería tradicional huilense: achiras, bizcochos de cuajada y avena fría. Ideal para el descanso entre clases.',
   3000, '3205551234', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=80',
   'Carrera 5 # 21-14, Neiva', 'Todos los días · 6:00 a. m. a 8:00 p. m.', 2.935200, -75.283400, 'APROBADO', NULL, 3);

INSERT INTO favoritos (usuario_id, sitio_id) VALUES (4, 1), (4, 4);

-- Menú de Cafetería Sin Fila
INSERT INTO productos (id, sitio_id, nombre, descripcion, precio, imagen_url, disponible) VALUES
  (1, 4, 'Asado huilense personal', 'Cerdo marinado al horno con arepa, yuca y ají.', 28000, 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80', TRUE),
  (2, 4, 'Bandeja para compartir', 'Asado para dos con insulso y limonada.', 56000, NULL, TRUE),
  (3, 4, 'Limonada de panela', 'Bebida fría tradicional (500 ml).', 6000, NULL, TRUE),
  (4, 5, 'Café filtrado Huila', 'Taza de 8 oz de café de origen.', 4500, 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=600&q=80', TRUE),
  (5, 5, 'Capuchino', 'Espresso doble con leche espumada.', 7000, NULL, TRUE),
  (6, 5, 'Achira con queso', 'Porción de achiras recién horneadas.', 3500, NULL, TRUE),
  (7, 5, 'Torta de chocolate', 'Porción individual.', 8000, NULL, FALSE),
  (8, 10, 'Bizcocho de cuajada', 'Unidad recién horneada.', 2500, NULL, TRUE),
  (9, 10, 'Avena fría', 'Vaso de 12 oz.', 4000, NULL, TRUE);

-- Pedidos de ejemplo (para el resumen de pagos y la lista de pendientes)
INSERT INTO pedidos (id, codigo, turista_id, cliente_nombre, sitio_id, estado, metodo_pago, estado_pago, total, referencia_pago, marca_tarjeta, ultimos4, notas, recoger_en, fecha) VALUES
  (1, 'HC-7K2P9Q', 4, 'Camila Restrepo', 5, 'ENTREGADO',      'TARJETA',  'PAGADO',    16000, 'SIM-4F9A21C7', 'VISA',  '4242', NULL,              NOW() - INTERVAL 2 DAY + INTERVAL 15 MINUTE, NOW() - INTERVAL 2 DAY),
  (2, 'HC-M3XR8T', 4, 'Camila Restrepo', 4, 'ENTREGADO',      'NEQUI',    'PAGADO',    34000, 'SIM-8B2C55D1', 'NEQUI', '3344', 'Sin ají, por favor', NOW() - INTERVAL 1 DAY + INTERVAL 20 MINUTE, NOW() - INTERVAL 1 DAY),
  (3, 'HC-Q9WD4L', 4, 'Camila Restrepo', 5, 'EN_PREPARACION', 'TARJETA',  'PAGADO',     8000, 'SIM-1D7E90AA', 'VISA',  '4242', NULL,              NOW() + INTERVAL 10 MINUTE, NOW() - INTERVAL 5 MINUTE),
  (4, 'HC-Z5HN2B', 4, 'Camila Restrepo', 4, 'PENDIENTE',      'EFECTIVO', 'PENDIENTE', 28000, NULL,           NULL,    NULL,   'Paso a las 12:30', NOW() + INTERVAL 25 MINUTE, NOW() - INTERVAL 1 MINUTE);

INSERT INTO pedido_items (pedido_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal) VALUES
  (1, 4, 'Café filtrado Huila', 4500, 2, 9000),
  (1, 6, 'Achira con queso',    3500, 2, 7000),
  (2, 1, 'Asado huilense personal', 28000, 1, 28000),
  (2, 3, 'Limonada de panela',  6000, 1, 6000),
  (3, 6, 'Achira con queso',    3500, 1, 3500),
  (3, 4, 'Café filtrado Huila', 4500, 1, 4500),
  (4, 1, 'Asado huilense personal', 28000, 1, 28000);

-- Guías turísticos de la región
INSERT INTO guias (id, nombre, foto_url, especialidad, idiomas, municipios, experiencia_anios, telefono, correo, rnt, tarifa_dia, calificacion, descripcion, activo) VALUES
  (1, 'Andrés Cuéllar', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80',
   'Astroturismo y desierto', 'Español, Inglés', 'Villavieja, Neiva', 9, '3114567890', 'andres.guia@huilaconecta.co', '84521',
   220000, 4.9, 'Guía certificado del Desierto de la Tatacoa. Recorridos al atardecer por el Cuzco y Los Hoyos y observación de estrellas con telescopio.', TRUE),
  (2, 'María Fernanda Trujillo', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=400&q=80',
   'Arqueología agustiniana', 'Español, Inglés, Francés', 'San Agustín, Isnos', 12, '3127654321', 'mafe.guia@huilaconecta.co', '73219',
   250000, 4.8, 'Antropóloga y guía del Parque Arqueológico. Explica la historia de las estatuas y lleva a miradores del Estrecho del Magdalena.', TRUE),
  (3, 'Jhon Fredy Perdomo', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=400&q=80',
   'Ruta del café', 'Español', 'Pitalito, Garzón, La Plata', 6, '3138889900', NULL, '66110',
   180000, 4.6, 'Recorridos por fincas cafeteras con cata, proceso de beneficio y almuerzo campesino. Ideal para grupos de estudiantes.', TRUE),
  (4, 'Laura Vargas', NULL,
   'Aventura y río Magdalena', 'Español, Inglés', 'Neiva, Rivera, Gigante', 4, '3145552211', 'laura.rafting@huilaconecta.co', NULL,
   160000, 4.5, 'Rafting suave, caminatas a cascadas y termales. Incluye equipo de seguridad y póliza de asistencia.', TRUE);

-- Comunidad
INSERT INTO publicaciones (id, autor_id, contenido, imagen_url, estado, motivo_moderacion, fecha) VALUES
  (1, 2, '¡Esta semana estrenamos la cata de café para estudiantes de la USCO! Pide por Cafetería Sin Fila y recoge sin esperar. ☕',
   'https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=900&q=80', 'VISIBLE', NULL, NOW() - INTERVAL 3 HOUR),
  (2, 3, 'Las noches en San Agustín están despejadas. Si vienen el fin de semana, reserven el refugio con tiempo.',
   NULL, 'VISIBLE', NULL, NOW() - INTERVAL 1 DAY),
  (3, 2, 'Promoción relámpago: escribe a mi WhatsApp personal para descuentos que no están en la plataforma.',
   NULL, 'OCULTA', 'Las promociones deben publicarse dentro de la plataforma.', NOW() - INTERVAL 2 DAY);

INSERT INTO comentarios (publicacion_id, autor_id, contenido, estado, fecha) VALUES
  (1, 4, '¡Qué buena idea! Mañana paso antes de clase.', 'VISIBLE', NOW() - INTERVAL 2 HOUR),
  (1, 3, 'Felicitaciones, Julián. El café de origen es lo mejor de Neiva.', 'VISIBLE', NOW() - INTERVAL 1 HOUR),
  (2, 4, '¿Tienen cupo para cuatro personas?', 'VISIBLE', NOW() - INTERVAL 20 HOUR);

INSERT INTO publicacion_likes (publicacion_id, usuario_id) VALUES (1, 4), (1, 3), (2, 4);

-- Galería de la turista de prueba
INSERT INTO fotos_usuario (usuario_id, url, descripcion) VALUES
  (4, 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=900&q=80', 'Atardecer en la Tatacoa'),
  (4, 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=900&q=80', 'Camino a San Agustín');

-- Verificación rápida
SELECT rol, COUNT(*) AS total FROM usuarios GROUP BY rol;
SELECT categoria, estado, COUNT(*) AS total FROM sitios_turisticos GROUP BY categoria, estado;
SELECT estado, COUNT(*) AS total FROM pedidos GROUP BY estado;
