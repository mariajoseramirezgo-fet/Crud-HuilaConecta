# HuilaConecta · Full Stack (v2.1 · backend Node.js)

Plataforma web que fomenta el **turismo regional del Huila** y conecta a la **comunidad estudiantil de Neiva** con emprendedores locales. Tiene tres roles con vistas y lógica separadas: **Administrador**, **Emprendedor** y **Turista / Estudiante**.

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS3 (variables, responsive), JavaScript Vanilla |
| Backend | **Node.js 18+ · Express 5** · mysql2 · bcryptjs (BCrypt) · multer (subida de imágenes) · dotenv |
| Base de datos | **MySQL 8**, creada y administrada con **MySQL Workbench** (`database/schema.sql`) |
| Sesión | Cookie **HttpOnly** emitida por el servidor + tabla `sesiones` en MySQL |
| Tiempo real | Server-Sent Events (SSE) para los pedidos de Cafetería Sin Fila |

> **Cambio de la v2.1:** el backend se migró de Java / Spring Boot a **Node.js / Express**. La API conserva las mismas rutas, respuestas JSON, validaciones y reglas de negocio, así que el frontend funciona igual (en `api.js` solo se actualizaron textos). La base de datos sigue siendo MySQL y se instala con el mismo script desde MySQL Workbench.

> No se usa `localStorage` ni `sessionStorage`: toda la información (usuarios, sesión, sitios, favoritos, imágenes, comunidad, pedidos y pagos) se guarda en MySQL a través de la API. Si el backend está apagado, la interfaz muestra un aviso con un botón para reintentar.

## Índice

1. [Cuentas y datos de prueba](#1-cuentas-y-datos-de-prueba)
2. [Estructura del repositorio](#2-estructura-del-repositorio)
3. [Instalación y ejecución](#3-instalación-y-ejecución)
4. [Solución de problemas](#4-solución-de-problemas)
5. [Funcionalidades por rol](#5-funcionalidades-por-rol)
6. [Seguridad y sesión](#6-seguridad-y-sesión-sin-localstorage)
7. [API REST](#7-api-rest)
8. [Modelo de datos](#8-modelo-de-datos)
9. [Validaciones](#9-validaciones-frontend--backend)
10. [Responsive y accesibilidad](#10-responsive-y-accesibilidad)
11. [Limitaciones conocidas](#11-limitaciones-conocidas)
12. [Guía de prompts para el video](#12-guía-de-prompts-para-el-video)

---

## 1. Cuentas y datos de prueba

Estas cuentas las crea `database/schema.sql`. Son **solo para pruebas locales**: cámbialas o borra esos usuarios antes de publicar el proyecto.

### 1.1 Usuarios de la aplicación

| Rol | Correo | Contraseña | Panel al que entra |
|---|---|---|---|
| Administrador | `admin@huilaconecta.co` | `Admin1234*` | `admin_dashboard.html` |
| Emprendedor | `emprendedor@huilaconecta.co` | `Empre123*` | `emprendedor_panel.html` |
| Emprendedor | `valentina@huilaconecta.co` | `Empre123*` | `emprendedor_panel.html` |
| Turista | `turista@huilaconecta.co` | `Turista123*` | `turista_portal.html` |

En la base de datos no están estas contraseñas sino su **hash BCrypt** (columna `usuarios.password_hash`). Si cambias una contraseña desde la aplicación, la de esta tabla deja de servir hasta que vuelvas a ejecutar el script.

### 1.2 Pagos de prueba (pasarela simulada)

| Método | Datos de prueba | Resultado |
|---|---|---|
| Tarjeta | `4242 4242 4242 4242` · cualquier titular · vencimiento futuro (ej. `12/30`) · CVV `123` | Aprobado |
| Tarjeta | `4000 0000 0000 0002` (mismos datos) | Rechazado por el "banco" |
| Nequi | Celular de 10 dígitos que empiece por 3 (ej. `3152223344`) | Aprobado |
| Efectivo | Sin datos | Queda "por cobrar" y se marca pagado al entregar |

### 1.3 Conexión a MySQL

| Dato | Valor por defecto | Dónde se cambia |
|---|---|---|
| Servidor y puerto | `localhost:3306` | `backend/.env` → `DB_HOST`, `DB_PORT` |
| Base de datos | `huilaconecta_db` | `backend/.env` → `DB_NAME` |
| Usuario | `root` | `backend/.env` → `DB_USER` |
| Contraseña | La de **tu** conexión en MySQL Workbench | `backend/.env` → `DB_PASSWORD` |

La contraseña de MySQL no se escribe en este README ni en el código: va únicamente en `backend/.env`, que está excluido de Git.

---

## 2. Estructura del repositorio

```
HuilaConecta_FullStack/
├── backend/
│   ├── package.json                 # Dependencias y comandos (npm start / npm run dev)
│   ├── .env.example                 # Plantilla de configuración (cópiala como .env)
│   └── src/
│       ├── server.js                # Punto de entrada: Express, CORS, rutas, frontend y errores
│       ├── config.js                # Lee backend/.env
│       ├── db.js                    # Pool de conexiones MySQL, consultas y transacciones
│       ├── middleware/sesion.js     # cargarUsuario, conSesion (401) y rol(...) (403)
│       ├── services/
│       │   ├── sesiones.js          # Cookie HttpOnly + tabla sesiones (hash SHA-256)
│       │   ├── pagoSimulado.js      # Pasarela simulada (Luhn, Nequi, efectivo)
│       │   └── pedidoNotificador.js # Tiempo real con SSE
│       ├── routes/                  # Un archivo por módulo de la API:
│       │   │                        # auth, usuarios, galeria, archivos, sitios, guias,
│       │   │                        # comunidad, productos, pedidos
│       └── utils/
│           ├── errores.js           # ApiError (error de negocio con código HTTP)
│           ├── validaciones.js      # Expresiones regulares y validadores compartidos
│           └── mapeos.js            # Filas de MySQL (snake_case) → JSON (camelCase)
├── database/schema.sql              # Esquema completo + datos de prueba (MySQL Workbench)
├── index.html · index.css · index.js   # Landing, login y registro (sin credenciales visibles)
├── styles.css                       # Estilos globales y responsive
├── api.js                           # Cliente de la API, validaciones y utilidades
├── componentes.js                   # Selector de imagen, Comunidad y Mi cuenta
├── admin_dashboard.html / .js
├── emprendedor_panel.html / .js
├── turista_portal.html / .js
└── README.md
```

---

## 3. Instalación y ejecución

### 3.1 Requisitos previos

- **MySQL Server 8** y **MySQL Workbench**.
- **Node.js 18 o superior** (incluye `npm`). Compruébalo en una terminal:
  ```bash
  node -v
  npm -v
  ```

### 3.2 Base de datos (MySQL Workbench)

1. Abre MySQL Workbench y entra a tu conexión local (`localhost:3306`).
2. **File → Open SQL Script…** y selecciona `database/schema.sql`.
3. Pulsa el rayo ⚡ (**Execute**) para ejecutar todo el script.
4. En el panel **SCHEMAS**, clic derecho → **Refresh All**: aparece `huilaconecta_db` con 13 tablas y los datos de prueba.
5. Verificación opcional en una pestaña de consulta:
   ```sql
   USE huilaconecta_db;
   SELECT id, nombre, correo, rol FROM usuarios;
   ```
   Deben salir 4 usuarios (1 ADMIN, 2 EMPRENDEDOR, 1 TURISTA).

> ⚠️ El script hace `DROP TABLE`: ejecutarlo de nuevo **borra todo** y vuelve a los datos iniciales. Si ya tenías la base de datos de la versión con Spring Boot, **vuelve a ejecutarlo** para que la cuenta del administrador coincida con la tabla de la sección 1.

### 3.3 Backend (Node.js)

1. En una terminal, entra a la carpeta del backend e instala las dependencias (solo la primera vez):
   ```bash
   cd backend
   npm install
   ```
2. Crea el archivo de configuración a partir de la plantilla y escribe en `DB_PASSWORD` la contraseña de tu MySQL:
   ```bash
   # Windows (CMD o PowerShell)
   copy .env.example .env

   # macOS / Linux
   cp .env.example .env
   ```
3. Inicia el servidor:
   ```bash
   npm start
   ```
   Durante el desarrollo puedes usar `npm run dev`, que reinicia el servidor al guardar cambios.
4. La terminal debe mostrar:
   ```
   ✔ Conectado a MySQL: root@localhost:3306/huilaconecta_db
   ✔ API disponible en http://localhost:8080/api
   ✔ Frontend disponible en http://localhost:8080
   ```

### 3.4 Frontend

**Opción recomendada:** abre **http://localhost:8080** en el navegador. Express sirve también las páginas (`.html`, `.css`, `.js` de la carpeta raíz), así la página y la API comparten origen y la cookie de sesión funciona sin configuración extra. Las carpetas `backend/` y `database/` no se publican.

**Opción Live Server:** abre `index.html` con Live Server (`http://localhost:5500` o `http://127.0.0.1:5500`). La API acepta esos orígenes con credenciales (CORS) y el frontend llama a `http://<mismo host>:8080/api`.

> Abrir el archivo con doble clic (`file://`) **no** funciona: el navegador no envía cookies desde ese origen. La página lo advierte.

> El frontend espera la API en el puerto **8080**. Si cambias `PORT` en `.env`, cambia también el puerto en `api.js` (`API_ORIGIN`).

---

## 4. Solución de problemas

| Mensaje o síntoma | Causa probable | Solución |
|---|---|---|
| `ER_ACCESS_DENIED_ERROR` al iniciar | Usuario o contraseña de MySQL incorrectos | Corrige `DB_USER` / `DB_PASSWORD` en `backend/.env` |
| `ER_BAD_DB_ERROR` o `ER_NO_SUCH_TABLE` | No se ha ejecutado el script | Ejecuta `database/schema.sql` en MySQL Workbench |
| `ECONNREFUSED` | MySQL está apagado | Inicia el servicio MySQL (en Windows: *Servicios → MySQL80*) |
| `El puerto 8080 ya está en uso` | Otro programa (o el backend anterior) usa el puerto | Ciérralo o cambia `PORT` en `.env` |
| `Cannot find module 'express'` | Faltan dependencias | Ejecuta `npm install` dentro de `backend/` |
| "Sin conexión con el servidor" en la página | El backend no está corriendo | Ejecuta `npm start` dentro de `backend/` |
| "Correo o contraseña incorrectos" con las cuentas de prueba | La base de datos es de una versión anterior o se cambió la contraseña | Vuelve a ejecutar `database/schema.sql` |
| Las horas salen corridas | El servidor MySQL usa otra zona horaria | Ajusta `DB_TIMEZONE` en `.env` (Colombia: `-05:00`) |

---

## 5. Funcionalidades por rol

### Administrador (`admin_dashboard`)
| Sección | Qué hace |
|---|---|
| Resumen | Contadores en vivo y gráfico de sitios aprobados **por categoría**. |
| Usuarios | CRUD global. No puede quitarse su propio rol ni desactivarse; desactivar a alguien cierra sus sesiones. |
| Moderación | Aprobar / rechazar sitios con motivo. |
| Sitios | **Filtros avanzados** por categoría (Experiencia, Hospedaje, Sabores, Transporte), estado y texto, aplicados en el servidor (`GET /api/sitios?categoria=&estado=&q=`). |
| Comunidad | Moderación de publicaciones y comentarios: ocultar (con motivo), restaurar o eliminar. |
| Guías | CRUD de guías turísticos con foto. |
| Mi cuenta | **Foto de perfil** (URL o archivo), datos y contraseña. |

### Emprendedor (`emprendedor_panel`)
| Sección | Qué hace |
|---|---|
| Mis servicios | CRUD con **imagen por URL o subida desde el PC**, dirección, horario y coordenadas con vista previa del mapa. Al crear o editar vuelve a *Pendiente*. |
| Cafetería Sin Fila → Pedidos en vivo | Tablero *Nuevos → En preparación → Listos* que se actualiza **en tiempo real (SSE)** con aviso de pedido nuevo. Si la conexión cae, consulta cada 15 s. |
| Cafetería Sin Fila → Resumen de pagos | Ventas de hoy / 7 días / mes, total cobrado, efectivo por cobrar, reembolsos, ticket promedio, ingresos por método y por sitio, y últimos movimientos con referencia. |
| Cafetería Sin Fila → Menú | CRUD de productos con foto y botón "Agotado". |
| Comunidad | Publicar (con imagen), editar, eliminar, comentar y dar "Me gusta". |
| Configuración | Foto de perfil, datos y **cambio de contraseña** (BCrypt; cierra las demás sesiones). |

### Turista / Estudiante (`turista_portal`)
| Sección | Qué hace |
|---|---|
| Explorar | Catálogo con búsqueda en tiempo real, filtros y orden. Ficha con **mapa (OpenStreetMap)**, dirección, horario y enlace "Cómo llegar". En restaurantes muestra el menú y el botón "Ordenar sin fila". |
| Guías | Listado con calificación, idiomas, municipios y tarifa; ficha detallada con RNT y contacto (llamada, WhatsApp, correo). |
| Comida sin fila | Menú → carrito → **pasarela de pago simulada** (tarjeta, Nequi o efectivo) → código de recogida. "Mis pedidos" se actualiza cada 15 s y permite cancelar mientras siga pendiente. |
| Comunidad | Comentar y dar "Me gusta". |
| Favoritos | Guardar y quitar sitios. |
| Mi perfil | **Galería de fotos personales** (subir, describir, eliminar), foto de perfil, datos, contraseña y eliminar cuenta (con confirmación de contraseña). |

### Pasarela de pago simulada
No se conecta a ningún banco. El total se calcula **en el servidor** con los precios de la BD.

Los datos de prueba también están resumidos en la [sección 1.2](#12-pagos-de-prueba-pasarela-simulada).

| Prueba | Resultado |
|---|---|
| `4242 4242 4242 4242`, fecha futura, CVV de 3 dígitos | Aprobado |
| `4000 0000 0000 0002` | Rechazado por el "banco" (para mostrar el error) |
| Nequi: celular de 10 dígitos que empiece por 3 | Aprobado |
| Efectivo | Queda "por cobrar" y se marca pagado al entregar |

Nunca se guarda el número completo ni el CVV: solo la marca y los últimos 4 dígitos.

---

## 6. Seguridad y sesión (sin localStorage)

1. `POST /api/auth/login` valida con BCrypt (`bcryptjs`) y crea una fila en `sesiones` con el **hash SHA-256** de un token aleatorio de 256 bits.
2. El token viaja en la cookie `HC_SESION` (`HttpOnly`, `SameSite=Lax`, 8 h renovables). JavaScript no puede leerla.
3. El middleware `cargarUsuario` (`backend/src/middleware/sesion.js`) revisa cada petición a `/api/**`. Las rutas protegidas usan `conSesion` (sin sesión → **401**) o `rol('ADMIN', …)` (rol incorrecto → **403**). Las rutas públicas simplemente no llevan esos middlewares.
4. Cada página privada pregunta `GET /api/auth/me` al cargar; si no hay sesión, vuelve al inicio.
5. El **tema claro/oscuro** también se guarda en MySQL (`usuarios.tema`).
6. Todas las consultas SQL usan parámetros (`?`), nunca texto concatenado: no hay inyección SQL.
7. Los errores se devuelven como `{"mensaje": "...", "estado": 400}`; las trazas quedan en la consola del servidor y nunca llegan al navegador.

Imágenes: se aceptan JPG, PNG, WEBP o GIF de máximo 2 MB. El servidor verifica la firma real del archivo (no solo la extensión) y guarda los bytes en la tabla `archivos` (MEDIUMBLOB). Se sirven en `/api/archivos/{id}`.

---

## 7. API REST

Base `http://localhost:8080/api` · errores en formato `{"mensaje": "...", "estado": 400}`.
🔓 = público · 🔒 = requiere sesión · (ROL) = rol exigido.

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/auth/login` · `/auth/registro` · `/auth/logout` | 🔓 |
| GET | `/auth/me` | 🔒 |
| GET / POST | `/usuarios` | ADMIN |
| PUT / DELETE | `/usuarios/{id}` | ADMIN |
| PUT | `/usuarios/me` · `/me/foto` · `/me/password` · `/me/tema` | 🔒 |
| DELETE | `/usuarios/me` (body `{password}`) | TURISTA, EMPRENDEDOR |
| GET · POST/DELETE | `/usuarios/me/favoritos` · `/usuarios/me/favoritos/{sitioId}` | TURISTA |
| GET / POST · PUT / DELETE | `/usuarios/me/fotos` · `/usuarios/me/fotos/{id}` | TURISTA |
| POST | `/archivos` (multipart, campo `archivo`) | 🔒 |
| GET | `/archivos/{id}` | 🔓 |
| GET | `/sitios?estado=&categoria=&q=` · `/sitios/estadisticas` | ADMIN |
| GET | `/sitios/aprobados?categoria=&q=` · `/sitios/{id}` | 🔓 |
| GET · POST · PUT | `/sitios/mios` · `/sitios` · `/sitios/{id}` | EMPRENDEDOR |
| DELETE | `/sitios/{id}` | EMPRENDEDOR (dueño), ADMIN |
| PATCH | `/sitios/{id}/estado` | ADMIN |
| GET | `/guias` · `/guias/{id}` | 🔓 |
| POST · PUT · DELETE | `/guias` · `/guias/{id}` | ADMIN |
| GET | `/comunidad/publicaciones` | 🔒 |
| GET · POST · PUT | `/comunidad/publicaciones/mias` · `/comunidad/publicaciones` · `/{id}` | EMPRENDEDOR |
| DELETE | `/comunidad/publicaciones/{id}` | autor, ADMIN |
| POST / DELETE | `/comunidad/publicaciones/{id}/like` | 🔒 |
| POST | `/comunidad/publicaciones/{id}/comentarios` | 🔒 |
| DELETE | `/comunidad/comentarios/{id}` | autor, autor de la publicación, ADMIN |
| GET | `/comunidad/moderacion/publicaciones` · `/comentarios` · `/resumen` | ADMIN |
| PATCH | `/comunidad/publicaciones/{id}/estado` · `/comunidad/comentarios/{id}/estado` | ADMIN |
| GET | `/productos/sitio/{sitioId}` | 🔓 |
| GET · POST · PUT · PATCH · DELETE | `/productos/mios` · `/productos` · `/productos/{id}` · `/{id}/disponible` | EMPRENDEDOR |
| POST · GET | `/pedidos` · `/pedidos/mios` | TURISTA |
| POST | `/pedidos/{id}/cancelar` | TURISTA |
| GET | `/pedidos/emprendedor?activos=true` · `/pedidos/emprendedor/resumen` | EMPRENDEDOR |
| GET | `/pedidos/emprendedor/stream` (SSE) | EMPRENDEDOR |
| PATCH | `/pedidos/{id}/estado` | EMPRENDEDOR |

---

## 8. Modelo de datos

```
usuarios ─┬─< sesiones                 (token_hash PK, cascade)
          ├─< archivos                 (propietario_id, SET NULL)
          ├─< sitios_turisticos ─┬─< productos ─< pedido_items (producto_id SET NULL)
          │                      ├─< pedidos ───< pedido_items (cascade)
          │                      └─< favoritos >── usuarios      (N:M)
          ├─< pedidos               (turista_id, SET NULL: se conserva el historial de ventas)
          ├─< fotos_usuario
          ├─< publicaciones ─┬─< comentarios
          │                  └─< publicacion_likes >── usuarios  (N:M, PK compuesta)
          └─< comentarios
guias (independiente, administrada por el ADMIN)
```

Restricciones destacadas: `CHECK` de rol, categoría, estados, teléfono de 10 dígitos (`REGEXP`), coordenadas dentro del Huila, precios mínimos, calificación 1–5 y cantidad 1–20; llaves foráneas con `ON DELETE CASCADE` o `SET NULL` según el caso.

---

## 9. Validaciones (frontend + backend)

| Campo | Regla |
|---|---|
| Teléfono / celular | Solo dígitos, **exactamente 10**. No se pueden escribir ni pegar letras (`data-solo-numeros`, `maxlength="10"`). |
| Precio, tarifa, años, RNT, CVV | Solo dígitos con rangos (ej. precio 1.000–50.000.000). |
| Latitud / longitud | Solo números, signo y punto (`data-decimal`); dentro del Huila; ambas o ninguna. |
| Tarjeta | 16 dígitos agrupados automáticamente + algoritmo de Luhn; vencimiento MM/AA vigente. |
| Nequi | 10 dígitos que empiecen por 3. |
| Nombres, municipios, idiomas | Solo letras. |
| Correo | Formato válido y único. |
| Contraseña | 8–64 caracteres, mayúscula, minúscula, número, símbolo y sin espacios (reglas en vivo). |
| Imagen | URL `http(s)` o archivo JPG/PNG/WEBP/GIF ≤ 2 MB (validado también por firma en el servidor). |
| Textos | Descripción 20–1000, publicación 3–1000, comentario ≤ 500, motivos de moderación ≥ 5. |

Las mismas reglas se repiten en el servidor (`backend/src/utils/validaciones.js` y cada archivo de `routes/`) y en los `CHECK` de MySQL: no se pueden saltar desde el navegador.

---

## 10. Responsive y accesibilidad
- Sin desplazamiento horizontal en **320, 360, 375, 414, 768, 1024 y 1280 px** en los tres paneles y todas sus pestañas.
- Tablas que se convierten en tarjetas en móvil; tablero de pedidos de 1 → 3 columnas; carrito fijo en escritorio.
- Modo claro/oscuro, pestañas navegables con flechas, foco visible, `aria-live` en resultados y contenido de usuario escapado (prevención de XSS).

---

## 11. Limitaciones conocidas
- **CORS:** en desarrollo se aceptan `localhost` y `127.0.0.1` en cualquier puerto. En producción limita `origenPermitido` (`backend/src/config.js`) al dominio real y sirve el sitio con HTTPS (agrega `Secure` a la cookie en `services/sesiones.js`).
- **Pagos:** la pasarela es simulada; para producción se integraría un proveedor real (Wompi, PayU…) con su SDK.
- **Imágenes huérfanas:** si subes una imagen y luego no guardas el formulario, el archivo queda en la tabla `archivos`.
- **Mapas:** se usa el visor público de OpenStreetMap; requiere internet en el navegador.
- **Intentos de login:** no hay límite de intentos fallidos; conviene agregarlo antes de publicar.
- **Pruebas automáticas:** el repositorio no incluye una suite de pruebas; es una mejora pendiente.

---

## 12. Guía de prompts para el video

1. **Contexto:** «Explica en 2 minutos qué problema resuelve HuilaConecta y por qué tiene tres roles.»
2. **Sin localStorage:** «Muestra en DevTools → Application que `localStorage` y `sessionStorage` están vacíos, y que la sesión es la cookie `HC_SESION` (HttpOnly).»
3. **Base de datos:** «Recorre `schema.sql` en MySQL Workbench: tablas, llaves foráneas, `ON DELETE CASCADE` vs `SET NULL` y por qué los pedidos conservan el historial.»
4. **Backend Node.js:** «Recorre `server.js` y un archivo de `routes/`: cómo una petición pasa por CORS, `cargarUsuario`, la validación, la consulta SQL parametrizada y el manejador de errores.»
5. **Seguridad:** «Explica `conSesion` y `rol(...)` en `middleware/sesion.js`. Prueba en el navegador `/api/usuarios` sin sesión (401) y como turista (403).»
6. **Demo Administrador:** «Filtra sitios por categoría, aprueba uno, oculta una publicación con motivo, crea un guía y cambia tu foto de perfil subiendo un archivo.»
7. **Demo Emprendedor:** «Publica un restaurante con imagen desde el PC y coordenadas, crea un producto del menú y deja abierto el tablero de pedidos.»
8. **Demo Turista:** «Abre el restaurante (mapa y menú), ordena, prueba la tarjeta rechazada y luego la aprobada; muestra cómo el pedido aparece al instante en el panel del emprendedor.»
9. **Resumen de pagos:** «Entrega un pedido en efectivo y muestra cómo cambia el resumen.»
10. **Comunidad y galería:** «Comenta, da Me gusta y sube una foto a la galería personal.»
11. **Responsive:** «Muestra los paneles en 360, 768 y 1280 px.»
12. **Cierre:** «¿Qué falta para producción? (HTTPS, pasarela real, límite de intentos, pruebas automáticas, despliegue).»

---

**Créditos:** Proyecto académico HuilaConecta · Fotografías de ambientación de Unsplash · Mapas © colaboradores de OpenStreetMap · Precios ilustrativos y pagos simulados.
