# NAD Constructora — Sitio Web Oficial

Sitio web corporativo con panel de administración CMS integrado para gestión de proyectos, textos, imágenes y configuración.

## Tecnologías

- **Backend:** Node.js + Express
- **Base de datos:** SQLite 3 (persistida en Railway Volume)
- **Frontend:** HTML5 + CSS Vanilla + JavaScript
- **Deploy:** Railway

---

## Desarrollo local

### Requisitos
- Node.js 20, 22 o 24 (el proyecto limita versiones futuras no verificadas)

### Instalación

```bash
npm install
```

En una base de datos nueva hay que definir `ADMIN_DEFAULT_PASS` en el primer arranque para crear el usuario administrador. No existe una contraseña predeterminada dentro del código.

Ejemplo en macOS/Linux:

```bash
ADMIN_DEFAULT_PASS='una-clave-local-larga' ADMIN_PATH='mi-panel-local' npm run dev
```

Ejemplo en PowerShell:

```powershell
$env:ADMIN_DEFAULT_PASS='una-clave-local-larga'
$env:ADMIN_PATH='mi-panel-local'
npm run dev
```

El sitio quedará disponible en **http://localhost:3000**. La ruta del panel será la configurada en `ADMIN_PATH`.

En desarrollo, si no se define `SESSION_SECRET`, el servidor genera uno temporal al iniciar. Para sesiones estables entre reinicios conviene definir también un secreto propio.

---

## Deploy en Railway

### 1. Variables de entorno

Configurar estas variables desde Railway, sin guardarlas en el repositorio:

| Variable | Uso | Recomendación |
|---|---|---|
| `SESSION_SECRET` | Firma de las sesiones | Obligatoria en producción. Usar un valor aleatorio de al menos 32 caracteres |
| `ADMIN_DEFAULT_PASS` | Crea el administrador cuando la base está vacía | Usar una contraseña inicial única de al menos 12 caracteres |
| `ADMIN_PATH` | Ruta del panel administrativo | Usar una ruta propia y no predecible |
| `NODE_ENV` | Entorno de ejecución | `production` |
| `PORT` | Puerto HTTP | Railway normalmente lo inyecta automáticamente |
| `SITE_URL` | Origen canónico y validación de solicitudes | `https://nadconstructora.com.py` |
| `TRUST_PROXY_HOPS` | Proxies confiables delante de Node | `1` en Railway, salvo que cambie la topología |
| `DATA_DIR` | Base y datos persistentes | Ruta exacta del volumen montado, por ejemplo `/data` |
| `UPLOADS_DIR` | Archivos subidos | Opcional; por defecto usa `DATA_DIR/uploads` |

Para generar un `SESSION_SECRET` seguro:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`ADMIN_DEFAULT_PASS` se utiliza solamente para crear el administrador cuando todavía no existe en la base de datos. Después de crear la cuenta se puede cambiar la contraseña desde el panel. No hace falta mantener esa variable para los siguientes reinicios si la base persistente ya contiene el administrador.

### 2. Volumen persistente

La base de datos y los archivos subidos necesitan almacenamiento persistente. En Railway:

1. Abrir el proyecto y elegir **Add Volume**.
2. Crear un volumen, por ejemplo `nad-data`.
3. Montarlo, por ejemplo, en `/data` y configurar `DATA_DIR=/data`. Se puede omitir `UPLOADS_DIR` para conservar los archivos en `/data/uploads`.
4. Confirmar que el volumen siga conectado antes de reemplazar o recrear el servicio.

Esto evita perder proyectos, configuración y archivos subidos durante redeploys.
En producción, `/health` responde `503` si no se configuró almacenamiento persistente, evitando promover silenciosamente una instancia que perdería datos.

### 3. Deploy

1. Conectar el repositorio de GitHub a Railway.
2. Configurar las variables de entorno anteriores.
3. Configurar el volumen persistente.
4. Railway utilizará `railway.json`, cuyo comando de inicio es `npm start`.
5. El health check del servicio usa `/health`.

La aplicación usa SQLite y archivos locales, por lo que debe mantenerse en **una sola réplica**. Para escalar horizontalmente sería necesario migrar la base de datos y los uploads a servicios compartidos.

### Respaldos

El panel descarga un ZIP con una instantánea consistente de SQLite y la carpeta de uploads. El backup excluye sesiones administrativas. Guardarlo fuera de Railway y comprobar periódicamente que se pueda restaurar.

---

## Seguridad incluida

La aplicación incluye actualmente:

- sesiones persistentes en SQLite;
- cookies `httpOnly`, `SameSite=Strict` y seguras en producción;
- regeneración de sesión después del login;
- límite de intentos de acceso;
- validación de origen para operaciones administrativas;
- validación MIME y firma real de archivos subidos;
- Content Security Policy y otros headers de Helmet;
- sanitización del contenido dinámico del CMS;
- validación estricta de colores, fuentes, URLs y claves editables del CMS;
- backups consistentes aun cuando SQLite utiliza WAL;
- limpieza de archivos huérfanos cuando una operación falla;
- escape de valores dinámicos dentro del panel administrativo;
- páginas de proyectos con 404 real y metadatos SEO propios;
- comprobaciones automáticas mediante GitHub Actions;
- auditoría automática de dependencias.
- pruebas de regresión para CMS, backups, uploads, health checks y reinicios.

---

## Estructura principal

```text
nad/
├── server.js
├── security-bootstrap.js
├── index.html
├── project.html
├── project-detail.css
├── styles.css
├── script.js
├── proyectos.js
├── package.json
├── railway.json
├── lib/
│   ├── security-config.js
│   ├── sqlite-session-store.js
│   ├── content-validation.js
│   ├── database-migrations.js
│   └── backup.js
├── admin/
│   ├── index.html
│   └── login.html
├── public/
│   └── uploads/        # ignorado por Git
└── data/               # base SQLite y datos persistentes; ignorado por Git
```

---

## Panel de administración

El panel permite gestionar sin tocar código:

- **Proyectos:** agregar, editar, eliminar y controlar visibilidad.
- **Textos:** editar contenido del sitio.
- **Diseño:** tipografía, colores y estilos.
- **Imágenes y videos:** gestionar contenido multimedia.
- **Configuración:** cambiar la contraseña administrativa.

## Antes de hacer merge o deploy

Esperar que los workflows **NAD quality CI** y **Dependency audit** terminen correctamente. No subir archivos `.env`, bases `.db` ni carpetas de uploads al repositorio.
