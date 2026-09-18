const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const helmet = require('helmet');
const sharp = require('sharp');
const archiver = require('archiver');
const { getSessionSecret, getInitialAdminPassword, isProductionEnvironment } = require('./lib/security-config');
const SQLiteSessionStore = require('./lib/sqlite-session-store');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Soporte de Proxy para Railway (Cloudflare / Envoy) ───────────────────────
app.set('trust proxy', 1);

// ── Ruta secreta del panel admin ─────────────────────────────────────────────
const ADMIN_PATH = process.env.ADMIN_PATH || 'gestion-nad-2026';

// ── Directorios y Persistencia (Soporte de Railway Volume) ────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');

[DATA_DIR, UPLOADS_DIR, path.join(__dirname, 'public', 'uploads')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Base de datos SQLite ─────────────────────────────────────────────────────
const db = new sqlite3.Database(path.join(DATA_DIR, 'nad.db'));

// Activar WAL mode para mejor rendimiento con escrituras concurrentes
db.run('PRAGMA journal_mode=WAL', (err) => {
    if (!err) console.log('📀 SQLite WAL mode activado');
});
// Si la DB está ocupada (escritura concurrente), esperar hasta 5s en vez de
// fallar al instante con SQLITE_BUSY — evita errores intermitentes bajo carga.
db.run('PRAGMA busy_timeout = 5000');

// Proyectos iniciales (3 destacados en portada, 3 en ver más proyectos)
const INITIAL_PROJECTS = [
    {
        title: 'Edificio Comercial',
        category: 'Construcción y Diseño Estructural',
        description: 'Desarrollo integral de edificio comercial. El proyecto comprendió el diseño arquitectónico, el cálculo estructural y la ejecución completa de la obra, cumpliendo con todas las normativas vigentes y los estándares de calidad.',
        location: 'Área Comercial',
        year: 2025,
        image: '/Construccion de edificio comercial.png',
        featured: 1
    },
    {
        title: 'Proyecto Domicilio',
        category: 'Proyecto Integral — Vivienda',
        description: 'Proyecto integral de vivienda unifamiliar ejecutado llave en mano. Nuestro equipo se encargó de la planificación, diseño arquitectónico, dirección de obra y fiscalización, logrando un hogar funcional y estético construido con materiales de primera calidad.',
        location: 'Zona Residencial',
        year: 2024,
        image: '/Proyecto domicilio.png',
        featured: 1
    },
    {
        title: 'Desarrollo Comercial',
        category: 'Estudio de Factibilidad y Fiscalización',
        description: 'Realizamos el estudio de factibilidad completo para este desarrollo comercial: análisis de localización, factibilidad económica y análisis de rentabilidad. Posteriormente asumimos la dirección y fiscalización de la obra, garantizando el cumplimiento del cronograma y presupuesto pactado.',
        location: 'Avenida Principal',
        year: 2023,
        image: 'https://images.unsplash.com/photo-1581094794329-c8112a89af12?auto=format&fit=crop&q=80&w=1200',
        featured: 1
    },
    {
        title: 'Residencia Moderna',
        category: 'Proyecto Integral — Vivienda',
        description: 'Diseño y construcción de residencia moderna de dos plantas. El proyecto incluyó el proyecto arquitectónico completo, estructural, instalaciones especiales y ejecución de obra, logrando una vivienda funcional y estéticamente destacada.',
        location: 'Zona Residencial Norte',
        year: 2022,
        image: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&q=80&w=1200',
        featured: 0
    },
    {
        title: 'Centro Corporativo',
        category: 'Construcción Corporativa',
        description: 'Construcción de centro corporativo de oficinas. El proyecto abarcó la planificación, diseño arquitectónico interior y exterior, sistemas de climatización, seguridad electrónica y construcción completa de la obra.',
        location: 'Centro Empresarial',
        year: 2021,
        image: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=1200',
        featured: 0
    },
    {
        title: 'Complejo Residencial',
        category: 'Estudio de Factibilidad y Construcción',
        description: 'Desarrollo de complejo residencial multifamiliar. Realizamos el estudio de factibilidad, proyecto arquitectónico, cálculo estructural y ejecución de obra. El complejo cuenta con 12 unidades habitacionales con todas las comodidades modernas.',
        location: 'Zona Residencial Sur',
        year: 2020,
        image: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&q=80&w=1200',
        featured: 0
    }
];

// Configuración y textos por defecto del sitio (CMS)
const DEFAULT_CONTENT = {
    texts: {
        hero_label: 'Arquitectura · Diseño · Construcción',
        hero_title: 'Hacemos realidad <span class="text-gradient">tus proyectos</span> con excelencia',
        hero_desc: 'Somos una empresa de construcción comprometida con la calidad técnica y la innovación. Desde el estudio de factibilidad hasta la entrega de la obra, acompañamos cada etapa de su proyecto.',
        hero_btn_projects: 'Ver Proyectos',
        hero_btn_contact: 'Consultarnos',

        stats_years_num: '+35',
        stats_years_lbl: 'Años de Experiencia',
        stats_projects_num: '+50',
        stats_projects_lbl: 'Proyectos Entregados',
        stats_clients_num: '100%',
        stats_clients_lbl: 'Clientes Satisfechos',
        stats_areas_num: '3',
        stats_areas_lbl: 'Áreas de Servicio',

        services_title: 'Nuestros Servicios',
        services_subtitle: 'Ofrecemos soluciones completas para cada etapa de su proyecto, desde la concepción hasta la entrega final de la obra.',
        service_1_title: 'Estudio de Factibilidad',
        service_1_desc: 'Evaluamos la viabilidad de su inversión antes de comenzar. Análisis integral para asegurar el éxito de su proyecto desde la primera etapa.',
        service_1_items: 'Análisis de localización\nEstudios preliminares y anteproyectos\nFactibilidad económica\nAnálisis de rentabilidad',
        service_2_title: 'Proyecto Integral',
        service_2_desc: 'Diseñamos y planificamos su obra de forma completa, garantizando coherencia entre diseño, estructura y todos los sistemas especiales.',
        service_2_items: 'Proyecto de arquitectura\nDiseño y cálculo estructural\nInstalaciones especiales (alarmas, PCI, CCTV)\nCómputo métrico y presupuesto\nCronograma físico-financiero',
        service_3_title: 'Construcción',
        service_3_desc: 'Ejecutamos su obra con los más altos estándares de calidad, controlando tiempos, costos y seguridad en cada etapa del proceso constructivo.',
        service_3_items: 'Planificación general\nEjecución de obras\nDirección técnica\nFiscalización de obras',

        about_badge: 'Sobre Nosotros',
        about_title: 'Nuestra Visión',
        about_p1: 'En NAD Constructora, nuestra visión es transformar entornos a través de una arquitectura innovadora, funcional y sostenible. Con +35 años de trayectoria, trabajamos para ser referentes del sector en Paraguay, priorizando la calidad técnica, la seguridad y la plena satisfacción de cada cliente.',
        about_p2: 'Creemos que cada proyecto es único. Por eso, brindamos un trato personalizado y profesional desde la primera consulta hasta la entrega final de la obra.',
        about_director_role: 'Director & Fundador',
        about_director_name: 'Arquitecto — NAD',
        about_director_desc: 'Profesional con +35 años de experiencia en diseño y ejecución de proyectos. Su liderazgo garantiza excelencia técnica y estética en cada obra.',
        about_exp_years: '+35',
        about_exp_text: 'Años de<br>Experiencia',

        projects_title: 'Proyectos Destacados',
        projects_subtitle: 'Explora algunas de nuestras obras más recientes. Cada proyecto refleja nuestro compromiso con la calidad y el detalle.',
        btn_ver_mas: 'Ver más proyectos',
        btn_ver_menos: 'Ver menos proyectos',

        cta_title: '¿Tiene un proyecto en mente?',
        cta_subtitle: 'Cuéntenos su idea y nuestro equipo le asesorará sin compromiso. Estamos listos para convertir su visión en una realidad.',
        cta_btn_wsp: 'Consultar por WhatsApp',
        cta_btn_ig: 'Seguirnos en Instagram',
        cta_btn_ig_link: 'https://www.instagram.com/nadsaconstructora/',

        footer_desc: 'Transformamos ideas en realidades estructurales. Arquitectura, diseño y construcción con excelencia técnica en cada proyecto.',
        contact_address: 'Paraguay',
        contact_phone: '+595 981 076 445',
        contact_email: 'contacto@nadconstructora.com',
        contact_instagram: '@nadsaconstructora',
        contact_instagram_link: 'https://www.instagram.com/nadsaconstructora/',
        contact_wsp_link: 'https://wa.me/595981076445?text=Hola%20NAD%20Constructora%2C%20quiero%20agendar%20una%20reuni%C3%B3n',
        footer_copy: '© 2026 NAD Constructora. Todos los derechos reservados.'
    },
    styles: {
        font_heading: 'Outfit',
        font_body: 'Inter',
        hero_title_size: '4.5rem',
        h2_size: '2.5rem',
        body_font_size: '1rem',
        color_primary: '#C1121F',
        color_primary_dark: '#111111',
        color_accent: '#FFC300',
        color_bg: '#FAFAFA',
        color_border: '#D6DAE1',
        color_info: '#1F4E79',
        color_accent_light: '#FFF4C2'
    },
    section_styles: {
        hero: { text_color: '#FFFFFF', heading_color: '#FFFFFF', overlay_opacity: '0.65' },
        services: { bg_color: '#F5F6F8', text_color: '#2B2F36', heading_color: '#111111', card_bg: '#FFFFFF', card_border_color: '#C1121F', heading_size: '2.5rem', body_size: '1rem' },
        about: { bg_color: '#FFF4C2', text_color: '#111111', heading_color: '#111111', heading_size: '2.8rem', body_size: '1.1rem' },
        projects: { bg_color: '#FFFFFF', text_color: '#111111', heading_color: '#111111', card_bg: '#FAFAFA', heading_size: '2.5rem', body_size: '1rem' },
        video: { bg_color: '#FFF4C2', text_color: '#111111', heading_color: '#111111' },
        clients: { bg_color: '#ede5d9', text_color: '#111111', heading_color: '#111111' },
        cta: { text_color: '#FFFFFF', heading_color: '#FFFFFF', overlay_opacity: '0.70' },
        footer: { bg_color: '#111111', text_color: '#FFFFFF', link_hover_color: '#FFC300', heading_color: '#FFC300' }
    },
    images: {
        logo: 'nad.png',
        hero_bg: '',
        about_image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&q=80&w=800',
        cta_bg: ''
    },
    video: {
        title: 'Innovación en Construcción',
        description: 'Conoce cómo transformamos tus ideas en obras de ingeniería de primer nivel.',
        src: ''
    }
};

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS admin (
        id       INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS projects (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT NOT NULL,
        category    TEXT NOT NULL,
        description TEXT NOT NULL,
        location    TEXT NOT NULL,
        year        INTEGER NOT NULL,
        image       TEXT NOT NULL,
        featured    INTEGER DEFAULT 1,
        visible     INTEGER DEFAULT 1,
        extra_media TEXT DEFAULT '[]',
        status      TEXT DEFAULT 'Terminado',
        created_at  TEXT DEFAULT (datetime('now'))
    )`);

    // Migraciones retrocompatibles para columnas añadidas posteriormente
    db.run(`ALTER TABLE projects ADD COLUMN featured INTEGER DEFAULT 1`, () => { });
    db.run(`ALTER TABLE projects ADD COLUMN extra_media TEXT DEFAULT '[]'`, (err) => {
        if (!err) console.log('✅ Columna extra_media migrada correctamente en projects');
    });
    db.run(`ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'Terminado'`, (err) => {
        if (!err) console.log('✅ Columna status migrada correctamente en projects');
    });
    db.run(`UPDATE projects SET extra_media = '[]' WHERE extra_media IS NULL`, () => { });
    db.run(`UPDATE projects SET status = 'Terminado' WHERE status IS NULL`, () => { });
    db.run(`UPDATE projects SET featured = 1 WHERE featured IS NULL`, () => { });
    db.run(`UPDATE projects SET visible = 1 WHERE visible IS NULL`, () => { });
    db.run(`UPDATE projects SET category = REPLACE(REPLACE(category, '&oacute;', 'ó'), '&ntilde;', 'ñ')`, () => { });
    db.run(`UPDATE projects SET title = REPLACE(REPLACE(title, '&oacute;', 'ó'), '&ntilde;', 'ñ')`, () => { });
    db.run(`UPDATE projects SET description = REPLACE(REPLACE(description, '&oacute;', 'ó'), '&ntilde;', 'ñ')`, () => { });

    db.run(`CREATE TABLE IF NOT EXISTS site_settings (
        id   INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
        ip         TEXT NOT NULL,
        attempts   INTEGER DEFAULT 0,
        locked_until TEXT,
        PRIMARY KEY (ip)
    )`);

    // Crear admin por defecto si no existe
    db.get('SELECT id FROM admin WHERE id = 1', (err, row) => {
        if (!row) {
            const defaultPass = getInitialAdminPassword();
            if (!defaultPass) {
                console.warn('⚠️ ADMIN_DEFAULT_PASS no configurado: no se creará un administrador inicial.');
                return;
            }
            const hashed = bcrypt.hashSync(defaultPass, 12);
            db.run("INSERT INTO admin (username, password) VALUES ('admin', ?)", [hashed]);
            console.log('✅ Admin inicial creado (usuario: admin)');
        }
    });

    // Cargar contenido inicial del sitio si no existe
    db.get('SELECT id FROM site_settings WHERE id = 1', (err, row) => {
        if (!row) {
            db.run('INSERT INTO site_settings (id, data) VALUES (1, ?)', [JSON.stringify(DEFAULT_CONTENT)]);
            console.log('📝 Contenido inicial del sitio cargado en la base de datos');
        }
    });

    // Cargar proyectos iniciales si la tabla está vacía
    db.get('SELECT COUNT(*) as cnt FROM projects', (err, row) => {
        if (!err && row.cnt === 0) {
            const stmt = db.prepare(
                'INSERT INTO projects (title, category, description, location, year, image, featured, visible) VALUES (?,?,?,?,?,?,?,1)'
            );
            INITIAL_PROJECTS.forEach(p => {
                stmt.run(p.title, p.category, p.description, p.location, p.year, p.image, p.featured !== undefined ? p.featured : 1);
            });
            stmt.finalize();
            console.log(`📦 ${INITIAL_PROJECTS.length} proyectos iniciales cargados en la base de datos`);
        }
    });
});

// ── Helpers de promesas ──────────────────────────────────────────────────────
const dbGet = (sql, p = []) => new Promise((res, rej) =>
    db.get(sql, p, (err, row) => err ? rej(err) : res(row)));

const dbAll = (sql, p = []) => new Promise((res, rej) =>
    db.all(sql, p, (err, rows) => err ? rej(err) : res(rows)));

const dbRun = (sql, p = []) => new Promise((res, rej) =>
    db.run(sql, p, function (err) { err ? rej(err) : res(this); }));

// ── Multer (Almacenamiento persistente) ───────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
        cb(null, name);
    }
});
const ALLOWED_UPLOAD_TYPES = new Map([
    ['.jpg', new Set(['image/jpeg'])],
    ['.jpeg', new Set(['image/jpeg'])],
    ['.jfif', new Set(['image/jpeg'])],
    ['.png', new Set(['image/png'])],
    ['.webp', new Set(['image/webp'])],
    ['.gif', new Set(['image/gif'])],
    ['.avif', new Set(['image/avif'])],
    ['.bmp', new Set(['image/bmp', 'image/x-ms-bmp'])],
    ['.mp4', new Set(['video/mp4'])],
    ['.mov', new Set(['video/quicktime'])],
    ['.webm', new Set(['video/webm'])]
]);

const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB máx
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedMimes = ALLOWED_UPLOAD_TYPES.get(ext);
        if (allowedMimes && allowedMimes.has(file.mimetype)) {
            return cb(null, true);
        }
        return cb(new Error('Formato o tipo MIME no admitido. Usá JPG, PNG, WEBP, GIF, AVIF, BMP, MP4, MOV o WEBM.'));
    }
});

function hasUploadSignature(file) {
    if (!file || !file.path) return false;
    const ext = path.extname(file.filename || file.originalname || '').toLowerCase();
    const fd = fs.openSync(file.path, 'r');
    const buffer = Buffer.alloc(32);
    let bytesRead = 0;
    try {
        bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    } finally {
        fs.closeSync(fd);
    }
    const b = buffer.subarray(0, bytesRead);
    const starts = (...values) => values.every((v, i) => b[i] === v);
    const ascii = b.toString('ascii');

    if (['.jpg', '.jpeg', '.jfif'].includes(ext)) return starts(0xff, 0xd8, 0xff);
    if (ext === '.png') return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    if (ext === '.gif') return ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
    if (ext === '.webp') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    if (ext === '.bmp') return ascii.startsWith('BM');
    if (ext === '.webm') return starts(0x1a, 0x45, 0xdf, 0xa3);
    if (ext === '.avif') return ascii.slice(4, 8) === 'ftyp' && (ascii.includes('avif') || ascii.includes('avis'));
    if (ext === '.mp4' || ext === '.mov') return ascii.slice(4, 8) === 'ftyp';
    return false;
}

const MAX_IMAGE_WIDTH = 1920;
const COMPRESSIBLE_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp']);

async function optimizeImageOnDisk(filePath, ext) {
    if (!COMPRESSIBLE_EXT.has(ext)) return;
    try {
        const buffer = await fs.promises.readFile(filePath);
        let img = sharp(buffer, { failOn: 'none' }).rotate(); // respeta orientación EXIF
        const meta = await img.metadata();
        if (meta.width && meta.width > MAX_IMAGE_WIDTH) {
            img = img.resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true });
        }
        let outBuffer;
        if (ext === '.png') outBuffer = await img.png({ quality: 82, compressionLevel: 8 }).toBuffer();
        else if (ext === '.webp') outBuffer = await img.webp({ quality: 82 }).toBuffer();
        else outBuffer = await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
        await fs.promises.writeFile(filePath, outBuffer);
    } catch (err) {
        console.warn('No se pudo comprimir la imagen, se conserva original:', err.message);
    }
}

function validateUploadedFiles(req, res, next) {
    const files = [];
    if (req.file) files.push(req.file);
    if (req.files) {
        for (const value of Object.values(req.files)) {
            if (Array.isArray(value)) files.push(...value);
        }
    }

    try {
        const invalid = files.find(file => !hasUploadSignature(file));
        if (!invalid) {
            // Optimizar imágenes válidas en disco en segundo plano antes de continuar
            Promise.all(files.map(file => {
                const ext = path.extname(file.path || file.filename || '').toLowerCase();
                return optimizeImageOnDisk(file.path, ext);
            })).catch(err => console.warn('Error optimizando imágenes:', err.message));

            return next();
        }

        for (const file of files) {
            try { if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (err) { }
        }
        return res.status(400).json({ error: 'El contenido real del archivo no coincide con un formato permitido.' });
    } catch (err) {
        for (const file of files) {
            try { if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (cleanupErr) { }
        }
        console.error('Error validando firma de archivo:', err);
        return res.status(400).json({ error: 'No se pudo validar el archivo subido.' });
    }
}

// Helper para borrar un archivo de uploads de forma segura (evita huérfanos en disco)
function deleteUploadFile(fileUrl) {
    if (!fileUrl || !fileUrl.startsWith('/uploads/')) return;
    const filename = path.basename(fileUrl);
    const p1 = path.join(UPLOADS_DIR, filename);
    const p2 = path.join(__dirname, 'public', 'uploads', filename);
    try {
        if (fs.existsSync(p1)) fs.unlinkSync(p1);
        else if (fs.existsSync(p2)) fs.unlinkSync(p2);
    } catch (err) {
        console.warn('No se pudo borrar archivo:', filename, err.message);
    }
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(compression());
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://unpkg.com',
                'https://cdn.jsdelivr.net',
                'https://cdn.plyr.io',
                'https://www.instagram.com'
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://cdn.plyr.io',
                'https://cdn.jsdelivr.net',
                'https://cdnjs.cloudflare.com',
                'https://fonts.googleapis.com'
            ],
            fontSrc: [
                "'self'",
                'data:',
                'https://fonts.gstatic.com',
                'https://cdnjs.cloudflare.com'
            ],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            mediaSrc: ["'self'", 'blob:', 'https:'],
            frameSrc: [
                "'self'",
                'https://www.youtube.com',
                'https://youtube.com',
                'https://www.youtube-nocookie.com',
                'https://www.instagram.com',
                'https://www.google.com'
            ],
            connectSrc: [
                "'self'",
                'https://www.instagram.com',
                'https://graph.instagram.com'
            ],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
            upgradeInsecureRequests: null
        }
    }
}));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Servir archivos estáticos de uploads tanto desde UPLOADS_DIR (Volumen) como fallback
// Los nombres de archivo subidos son únicos (timestamp + random) y nunca se reutilizan,
// así que se pueden cachear en el navegador por mucho tiempo sin riesgo de servir algo viejo.
const UPLOADS_CACHE = { maxAge: '30d', immutable: true };
app.use('/uploads', express.static(UPLOADS_DIR, UPLOADS_CACHE));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), UPLOADS_CACHE));
app.use('/public', express.static(path.join(__dirname, 'public'), UPLOADS_CACHE));
// --- SEO & Dynamic Rendering ---
const defaultMeta = {
    title: 'NAD Constructora | Arquitectura, Diseño y Construcción',
    desc: 'NAD Constructora ofrece servicios integrales de estudio de factibilidad, proyecto arquitectónico y construcción en Paraguay. Calidad, compromiso y excelencia técnica en cada obra.',
    image: '/nad.png',
    url: '/'
};

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function upsertMetaTag(html, attribute, name, content) {
    const safeContent = escapeHtml(content);
    const prefix = '<meta ' + attribute + '="' + name + '" content="';
    const lowerHtml = html.toLowerCase();
    const start = lowerHtml.indexOf(prefix.toLowerCase());
    if (start !== -1) {
        const contentStart = start + prefix.length;
        const contentEnd = html.indexOf('"', contentStart);
        if (contentEnd !== -1) {
            return html.slice(0, contentStart) + safeContent + html.slice(contentEnd);
        }
    }
    const tag = prefix + safeContent + '">';
    return html.replace('</head>', '    ' + tag + '\n</head>');
}

// ── Caché en memoria ─────────────────────────────────────────────────────────
// Convierte un hex (#RRGGBB) a "r, g, b" para poder armarlo en un rgba() con
// una opacidad fija en CSS (usado en el difuminado del menú sobre el hero).
function hexToRgbParts(hex, fallback = '255, 255, 255') {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
    if (!m) return fallback;
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// Multiplicador de intensidad del difuminado (1 = normal). Clamp para que un
// valor inválido o extremo del CMS no rompa el CSS ni deje un efecto absurdo.
function glowIntensity(raw) {
    const n = parseFloat(raw);
    if (!isFinite(n) || n <= 0) return 1;
    return Math.min(2.5, Math.max(0.3, n));
}
// Escala una opacidad base según la intensidad, sin pasarse nunca de 1.
function op(base, intensity) {
    return Math.min(1, base * intensity).toFixed(2);
}

// Las plantillas HTML no cambian en tiempo de ejecución: se leen del disco una
// sola vez al arrancar en lugar de en cada visita (evita I/O por request bajo carga).
const htmlTemplateCache = {};
function getHtmlTemplate(filename) {
    if (!htmlTemplateCache[filename]) {
        htmlTemplateCache[filename] = fs.readFileSync(path.join(__dirname, filename), 'utf8');
    }
    return htmlTemplateCache[filename];
}

// El contenido del CMS (site_settings) y los proyectos públicos se piden en
// CADA visita a la home. Se cachean en memoria y se invalidan solo cuando el
// admin guarda cambios, para no pegarle a SQLite en cada request bajo tráfico alto.
let cachedContent = null;
let cachedPublicProjects = null;
function invalidateContentCache() { cachedContent = null; }
function invalidateProjectsCache() { cachedPublicProjects = null; }

async function getContent() {
    if (cachedContent) return cachedContent;
    const row = await dbGet('SELECT data FROM site_settings WHERE id = 1');
    cachedContent = (row && row.data) ? JSON.parse(row.data) : DEFAULT_CONTENT;
    return cachedContent;
}

async function getPublicProjects() {
    if (cachedPublicProjects) return cachedPublicProjects;
    cachedPublicProjects = await dbAll('SELECT * FROM projects WHERE visible = 1 ORDER BY featured DESC, year DESC, id DESC');
    return cachedPublicProjects;
}

async function renderPageWithMeta(filename, req, res, metaOverride = {}) {
    const DOMAIN = req.protocol + '://' + req.get('host');
    const meta = { ...defaultMeta, ...metaOverride };

    try {
        // Obtener config para inyectar CSS variables y evitar FOUC
        const config = await getContent();
        const stylesData = config ? config.styles : null;
        let html = getHtmlTemplate(filename);

        // Inyectar estilos globales
            if (stylesData) {
                let sectionCss = '';
                const ss = (config && config.section_styles) ? config.section_styles : {};
                const secMap = {
                    navbar: 'header', hero: '.hero', stats: '.stats-bar',
                    services: '.services', about: '.about', projects: '.projects',
                    video: '.video-section', clients: '.clients-section',
                    cta: '.cta-section', footer: '.footer'
                };
                let allUsedFonts = new Set();
                if (stylesData.font_heading) allUsedFonts.add(stylesData.font_heading);
                if (stylesData.font_body) allUsedFonts.add(stylesData.font_body);

                for (const [key, sel] of Object.entries(secMap)) {
                    const s = ss[key];
                    if (!s) continue;
                    let vars = '';
                    if (s.bg_color) vars += `--sec-bg:${s.bg_color};`;
                    if (s.text_color) vars += `--sec-text:${s.text_color};`;
                    if (s.heading_color) vars += `--sec-heading:${s.heading_color};`;
                    if (s.card_bg) vars += `--sec-card-bg:${s.card_bg};`;
                    if (s.card_border_color) vars += `--sec-card-border:${s.card_border_color};`;
                    if (s.heading_size) vars += `--sec-h2:${s.heading_size};`;
                    if (s.body_size) vars += `--sec-body:${s.body_size};`;
                    if (s.overlay_opacity) vars += `--sec-overlay:${s.overlay_opacity};`;
                    if (s.link_hover_color) vars += `--sec-link-hover:${s.link_hover_color};`;
                    if (s.font_heading) {
                        vars += `--sec-font-heading:'${s.font_heading}', sans-serif;`;
                        allUsedFonts.add(s.font_heading);
                    }
                    if (s.font_body) {
                        vars += `--sec-font-body:'${s.font_body}', sans-serif;`;
                        allUsedFonts.add(s.font_body);
                    }
                    // Difuminado del logo/menú mientras el header flota sobre el hero
                    if (key === 'navbar' && (s.hero_glow_enabled !== undefined || s.hero_glow_color || s.hero_glow_intensity)) {
                        if (s.hero_glow_enabled === '0') {
                            vars += `--hero-glow-filter:drop-shadow(0 2px 8px rgba(0,0,0,.5));`;
                            vars += `--hero-glow-text-shadow:0 1px 4px rgba(0,0,0,.6);`;
                        } else {
                            const rgb = hexToRgbParts(s.hero_glow_color);
                            const i = glowIntensity(s.hero_glow_intensity);
                            vars += `--hero-glow-filter:drop-shadow(0 0 ${6 * i}px rgba(${rgb},${op(.55, i)})) drop-shadow(0 2px 8px rgba(0,0,0,.5));`;
                            vars += `--hero-glow-text-shadow:0 0 ${4 * i}px rgba(${rgb},${op(.4, i)}), 0 1px 6px rgba(0,0,0,.45);`;
                        }
                    }
                    // Difuminado del título del hero (H1), independiente del de la barra:
                    // ayuda a que el texto se siga leyendo si la foto de fondo tiene zonas claras.
                    if (key === 'hero' && (s.heading_glow_enabled !== undefined || s.heading_glow_color || s.heading_glow_intensity)) {
                        if (s.heading_glow_enabled === '0') {
                            vars += `--heading-glow-text-shadow:none;`;
                        } else {
                            const rgb = hexToRgbParts(s.heading_glow_color);
                            const i = glowIntensity(s.heading_glow_intensity);
                            vars += `--heading-glow-text-shadow:0 0 ${18 * i}px rgba(${rgb},${op(.5, i)}), 0 2px 10px rgba(0,0,0,.4);`;
                        }
                    }
                    if (vars) sectionCss += `${sel}{${vars}}`;
                }

                // Generate Google Fonts URL dynamically for all used fonts
                const gFontsUrl = Array.from(allUsedFonts).map(f => `family=${f.replace(/ /g, '+')}:wght@300;400;500;600;700;800`).join('&');

                const dynamicStyle = `
                <link id="dynamic-fonts" href="https://fonts.googleapis.com/css2?${gFontsUrl}&display=swap" rel="stylesheet">
                <style>
                    :root {
                        --font-heading: '${stylesData.font_heading}', sans-serif;
                        --font-body: '${stylesData.font_body}', sans-serif;
                        --hero-title-size: ${stylesData.hero_title_size};
                        --h2-size: ${stylesData.h2_size};
                        --body-font-size: ${stylesData.body_font_size};
                        --primary: ${stylesData.color_primary};
                        --primary-dark: ${stylesData.color_primary_dark};
                        --accent: ${stylesData.color_accent};
                        --bg-light: ${stylesData.color_bg};
                        ${stylesData.color_border ? '--border:' + stylesData.color_border + ';' : ''}
                        ${stylesData.color_info ? '--info:' + stylesData.color_info + ';' : ''}
                        ${stylesData.color_accent_light ? '--accent-light:' + stylesData.color_accent_light + ';' : ''}
                    }
                    ${sectionCss}
                </style>`;
                html = html.replace('</head>', `${dynamicStyle}\n</head>`);
            }

            if (metaOverride.title) {
                html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);
                html = html.replace(/<meta property="og:title" content="[^"]*"/i, `<meta property="og:title" content="${escapeHtml(meta.title)}"`);
                html = html.replace(/<meta name="twitter:title" content="[^"]*"/i, `<meta name="twitter:title" content="${escapeHtml(meta.title)}"`);
            }
            if (metaOverride.desc) {
                html = html.replace(/<meta name="description" content="[^"]*"/i, `<meta name="description" content="${escapeHtml(meta.desc)}"`);
                html = html.replace(/<meta property="og:description" content="[^"]*"/i, `<meta property="og:description" content="${escapeHtml(meta.desc)}"`);
                html = html.replace(/<meta name="twitter:description" content="[^"]*"/i, `<meta name="twitter:description" content="${escapeHtml(meta.desc)}"`);
            }
            if (metaOverride.image) {
                const img = meta.image.startsWith('http') ? meta.image : DOMAIN + meta.image;
                html = html.replace(/<meta property="og:image" content="[^"]*"/i, `<meta property="og:image" content="${escapeHtml(img)}"`);
                html = html.replace(/<meta name="twitter:image" content="[^"]*"/i, `<meta name="twitter:image" content="${escapeHtml(img)}"`);
            }
            if (metaOverride.url) {
                const u = meta.url.startsWith('http') ? meta.url : DOMAIN + meta.url;
                html = html.replace(/<meta property="og:url" content="[^"]*"/i, `<meta property="og:url" content="${escapeHtml(u)}"`);
            }
            const canonicalPath = metaOverride.url || (req.path === '/index.html' ? '/' : req.path);
            const canonicalUrl = canonicalPath.startsWith('http') ? canonicalPath : DOMAIN + canonicalPath;
            const socialImage = meta.image && meta.image.startsWith('http') ? meta.image : DOMAIN + (meta.image || '/nad.png');

            html = upsertMetaTag(html, 'property', 'og:title', meta.title);
            html = upsertMetaTag(html, 'property', 'og:description', meta.desc);
            html = upsertMetaTag(html, 'property', 'og:image', socialImage);
            html = upsertMetaTag(html, 'property', 'og:url', canonicalUrl);
            html = upsertMetaTag(html, 'name', 'twitter:card', 'summary_large_image');
            html = upsertMetaTag(html, 'name', 'twitter:title', meta.title);
            html = upsertMetaTag(html, 'name', 'twitter:description', meta.desc);
            html = upsertMetaTag(html, 'name', 'twitter:image', socialImage);

            const canonicalTag = '<link rel="canonical" href="' + escapeHtml(canonicalUrl) + '">';
            if (/<link\s+rel=["']canonical["'][^>]*>/i.test(html)) {
                html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/i, canonicalTag);
            } else {
                html = html.replace('</head>', '    ' + canonicalTag + '\n</head>');
            }

            res.send(html);
    } catch (e) {
        console.error('Error renderizando página:', e);
        res.status(500).send('Error');
    }
}

app.get('/', (req, res) => renderPageWithMeta('index.html', req, res));
app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.get('/proyectos', (req, res) => renderPageWithMeta('proyectos.html', req, res, {
    title: 'Proyectos | NAD Constructora',
    desc: 'Conocé proyectos de arquitectura, diseño estructural y construcción desarrollados por NAD Constructora en Paraguay.',
    image: '/nad.png',
    url: '/proyectos'
}));
app.get('/proyectos.html', (req, res) => res.redirect(301, '/proyectos'));

function safePublicMediaUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    try {
        const parsed = new URL(raw);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch (err) { }
    return null;
}

function renderProjectPage(req, res, row) {
    const domain = req.protocol + '://' + req.get('host');
    const canonicalUrl = domain + '/proyecto/' + row.id;
    const primaryUrl = safePublicMediaUrl(row.image) || '/nad.png';
    const isPrimaryVideo = /\.(mp4|webm|mov)(?:$|\?)/i.test(primaryUrl);
    const primaryMedia = isPrimaryVideo
        ? `<video src="${escapeHtml(primaryUrl)}" controls playsinline preload="metadata"></video>`
        : `<img src="${escapeHtml(primaryUrl)}" alt="${escapeHtml(row.title)}" loading="eager" decoding="async">`;

    let galleryItems = [];
    try {
        const parsed = JSON.parse(row.extra_media || '[]');
        if (Array.isArray(parsed)) galleryItems = parsed;
    } catch (err) { }

    const galleryHtml = galleryItems
        .map(safePublicMediaUrl)
        .filter(Boolean)
        .map((url, index) => {
            if (/\.(mp4|webm|mov)(?:$|\?)/i.test(url)) {
                return `<div class="project-gallery-item"><video src="${escapeHtml(url)}" controls playsinline preload="metadata"></video></div>`;
            }
            return `<div class="project-gallery-item"><img src="${escapeHtml(url)}" alt="${escapeHtml(row.title)} — imagen ${index + 1}" loading="lazy" decoding="async"></div>`;
        })
        .join('');

    const gallerySection = galleryHtml
        ? `<section class="project-gallery"><div class="container"><h2>Galería del proyecto</h2><div class="project-gallery-grid">${galleryHtml}</div></div></section>`
        : '';

    const ogImage = isPrimaryVideo
        ? domain + '/nad.png'
        : (primaryUrl.startsWith('http') ? primaryUrl : domain + primaryUrl);

    const replacements = {
        '{{TITLE}}': escapeHtml(row.title || 'Proyecto'),
        '{{DESCRIPTION}}': escapeHtml(row.description || defaultMeta.desc),
        '{{CATEGORY}}': escapeHtml(row.category || 'Proyecto NAD'),
        '{{LOCATION}}': escapeHtml(row.location || 'Paraguay'),
        '{{YEAR}}': escapeHtml(row.year || ''),
        '{{STATUS}}': escapeHtml(row.status || 'Terminado'),
        '{{CANONICAL_URL}}': escapeHtml(canonicalUrl),
        '{{OG_IMAGE}}': escapeHtml(ogImage),
        '{{WHATSAPP_TEXT}}': encodeURIComponent(`Hola NAD Constructora, quiero consultar por un proyecto similar a "${row.title || 'este proyecto'}".`),
        '{{PRIMARY_MEDIA}}': primaryMedia,
        '{{GALLERY_SECTION}}': gallerySection
    };

    let html = getHtmlTemplate('project.html');
    for (const [placeholder, value] of Object.entries(replacements)) {
        html = html.split(placeholder).join(value);
    }

    res.type('html').send(html);
}

app.get('/proyecto/:id', (req, res) => {
    db.get('SELECT * FROM projects WHERE id = ? AND visible = 1', [req.params.id], (err, row) => {
        if (err) {
            console.error('Error cargando proyecto:', err);
            return res.status(500).send('Error interno');
        }
        if (!row) return res.status(404).send('Proyecto no encontrado');
        return renderProjectPage(req, res, row);
    });
});

// Servir solo archivos estáticos seguros (CSS, JS del cliente, imágenes, fuentes)
// Middleware que bloquea archivos sensibles ANTES de que express.static los sirva
const SAFE_EXTENSIONS = new Set(['.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.mov', '.avif', '.bmp', '.jfif', '.html']);
const BLOCKED_FILES = new Set(['server.js', 'security-bootstrap.js', 'project.html', 'package.json', 'package-lock.json', '.env', '.env.example', '.gitignore', 'railway.json']);
const DYNAMIC_ROUTES = new Set(['/sitemap.xml', '/robots.txt']);
app.use((req, res, next) => {
    if (DYNAMIC_ROUTES.has(req.path)) return next();
    const reqPath = decodeURIComponent(req.path);
    const basename = path.basename(reqPath);
    const ext = path.extname(basename).toLowerCase();
    // Bloquear archivos sensibles explícitamente
    if (BLOCKED_FILES.has(basename)) return res.status(404).send('Not found');
    // Bloquear acceso a directorios sensibles
    if (reqPath.includes('/data/') || reqPath.includes('/node_modules/') || reqPath.includes('/.git/') || reqPath.includes('/.github/') || reqPath.includes('/lib/') || reqPath.includes('/scripts/') || reqPath.includes('/backup_')) {
        return res.status(404).send('Not found');
    }
    // Bloquear extensiones no seguras (.db, .py, .env, .sql, etc.)
    if (ext && !SAFE_EXTENSIONS.has(ext)) return res.status(404).send('Not found');
    next();
});
// Bloquear acceso directo a la carpeta /admin (el panel real vive en la ruta
// secreta ADMIN_PATH) — DEBE ir antes de express.static, si no, cualquiera
// podría ver el HTML/JS del panel sin loguearse pidiendo /admin/index.html.
app.use('/admin', (req, res) => res.status(404).send('Not found'));
app.use(express.static(__dirname, {
    index: false,
    maxAge: '1h',
    // El sitio está en desarrollo activo: JS/CSS cambian seguido. Con
    // maxAge de 1h el navegador (sobre todo en celular) seguía usando la
    // copia vieja sin ni preguntarle al servidor, así que un cambio podía
    // tardar hasta una hora en verse. "no-cache" no significa "no guardar":
    // el navegador igual cachea el archivo, pero siempre revalida con el
    // servidor antes de usarlo (y si no cambió, responde rapidísimo con
    // un 304 sin reenviar el archivo entero).
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

app.use(session({
    name: 'nad.sid',
    store: new SQLiteSessionStore(db),
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        maxAge: 8 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'strict',
        secure: isProductionEnvironment() || process.env.COOKIE_SECURE === 'true'
    }
}));

// ── Auth ─────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (req.session && req.session.admin) return next();
    return res.redirect(`/${ADMIN_PATH}/login`);
}

function requireSameOrigin(req, res, next) {
    const expectedOrigin = req.protocol + '://' + req.get('host');
    const origin = req.get('origin');
    const referer = req.get('referer');

    try {
        if (origin && new URL(origin).origin === expectedOrigin) return next();
        if (!origin && referer && new URL(referer).origin === expectedOrigin) return next();
    } catch (err) { }

    return res.status(403).json({ error: 'Origen de solicitud no permitido' });
}

// Rate limiting para login (máx 5 intentos, bloqueo 15 min)
async function checkRateLimit(ip) {
    const now = new Date();
    let record = await dbGet('SELECT * FROM login_attempts WHERE ip = ?', [ip]);

    if (record) {
        if (record.locked_until && new Date(record.locked_until) > now) {
            const secs = Math.ceil((new Date(record.locked_until) - now) / 1000);
            return { blocked: true, seconds: secs };
        }
        if (record.attempts >= 5) {
            const lockUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
            await dbRun('UPDATE login_attempts SET locked_until = ?, attempts = 0 WHERE ip = ?', [lockUntil, ip]);
            return { blocked: true, seconds: 900 };
        }
    }
    return { blocked: false };
}

async function recordFailedAttempt(ip) {
    const existing = await dbGet('SELECT * FROM login_attempts WHERE ip = ?', [ip]);
    if (existing) {
        await dbRun('UPDATE login_attempts SET attempts = attempts + 1 WHERE ip = ?', [ip]);
    } else {
        await dbRun('INSERT INTO login_attempts (ip, attempts) VALUES (?, 1)', [ip]);
    }
}

async function resetAttempts(ip) {
    await dbRun('DELETE FROM login_attempts WHERE ip = ?', [ip]);
}

// ── Rutas Públicas ───────────────────────────────────────────────────────────


// Health check para Railway
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

// API pública
app.get('/api/projects', async (req, res) => {
    try {
        const rows = await getPublicProjects();
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/content', async (req, res) => {
    try {
        res.json(await getContent());
    } catch (e) {
        res.json(DEFAULT_CONTENT);
    }
});

// ── Rutas del Panel Admin (Ruta secreta) ────────────────────────────────────
app.get(`/${ADMIN_PATH}/login`, (req, res) => {
    if (req.session.admin) return res.redirect(`/${ADMIN_PATH}`);
    res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.post(`/${ADMIN_PATH}/login`, requireSameOrigin, async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    try {
        const limit = await checkRateLimit(ip);
        if (limit.blocked) {
            const mins = Math.ceil(limit.seconds / 60);
            return res.redirect(`/${ADMIN_PATH}/login?error=blocked&mins=${mins}`);
        }

        const { username, password } = req.body;
        const admin = await dbGet('SELECT * FROM admin WHERE username = ?', [username]);

        if (!admin || !bcrypt.compareSync(password, admin.password)) {
            await recordFailedAttempt(ip);
            const rec = await dbGet('SELECT attempts FROM login_attempts WHERE ip = ?', [ip]);
            const remaining = 5 - (rec ? rec.attempts : 1);
            return res.redirect(`/${ADMIN_PATH}/login?error=1&remaining=${Math.max(0, remaining)}`);
        }

        await resetAttempts(ip);
        await new Promise((resolve, reject) => {
            req.session.regenerate(err => err ? reject(err) : resolve());
        });
        req.session.admin = { id: admin.id, username: admin.username };
        await new Promise((resolve, reject) => {
            req.session.save(err => err ? reject(err) : resolve());
        });
        return res.redirect(`/${ADMIN_PATH}`);
    } catch (e) {
        console.error(e);
        res.redirect(`/${ADMIN_PATH}/login?error=1`);
    }
});

app.post(`/${ADMIN_PATH}/logout`, requireAuth, requireSameOrigin, (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'No se pudo cerrar la sesión' });
        res.clearCookie('nad.sid');
        return res.status(204).end();
    });
});

app.get(`/${ADMIN_PATH}`, requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.use(`/${ADMIN_PATH}/api`, (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    return requireSameOrigin(req, res, next);
});

// ── API admin: Proyectos ─────────────────────────────────────────────────────
app.get(`/${ADMIN_PATH}/api/projects`, requireAuth, async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM projects ORDER BY featured DESC, year DESC, id DESC');
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post(`/${ADMIN_PATH}/api/projects`, requireAuth, (req, res, next) => {
    upload.fields([{ name: 'image', maxCount: 1 }, { name: 'extra_media', maxCount: 15 }])(req, res, err => {
        if (err) return res.status(400).json({ error: err.message });
        return validateUploadedFiles(req, res, next);
    });
}, async (req, res) => {
    if (!req.files || !req.files['image']) return res.status(400).json({ error: 'Se requiere una imagen o video para el proyecto' });
    const { title, category, description, location, year, featured, visible, status } = req.body;
    if (!title || !category || !description || !location) {
        return res.status(400).json({ error: 'Completá todos los campos obligatorios' });
    }
    const imagePath = '/uploads/' + req.files['image'][0].filename;

    let extraMediaUrls = [];
    if (req.files['extra_media']) {
        extraMediaUrls = req.files['extra_media'].map(f => '/uploads/' + f.filename);
    }
    const extraMediaJson = JSON.stringify(extraMediaUrls);

    const numYear = parseInt(year) || new Date().getFullYear();
    const numFeatured = featured !== undefined && featured !== '' ? parseInt(featured) : 1;
    const numVisible = visible !== undefined && visible !== '' ? parseInt(visible) : 1;

    try {
        const result = await dbRun(
            'INSERT INTO projects (title, category, description, location, year, image, featured, visible, extra_media, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [title.trim(), category.trim(), description.trim(), location.trim(), numYear, imagePath, numFeatured, numVisible, extraMediaJson, status || 'Terminado']
        );
        invalidateProjectsCache();
        res.json({ id: result.lastID, image: imagePath });
    } catch (e) {
        console.error('Error creando proyecto:', e);
        res.status(500).json({ error: e.message || 'Error al guardar proyecto' });
    }
});

app.put(`/${ADMIN_PATH}/api/projects/:id`, requireAuth, (req, res, next) => {
    upload.fields([{ name: 'image', maxCount: 1 }, { name: 'extra_media', maxCount: 15 }])(req, res, err => {
        if (err) return res.status(400).json({ error: err.message });
        return validateUploadedFiles(req, res, next);
    });
}, async (req, res) => {
    const { title, category, description, location, year, featured, visible, kept_extra_media, status } = req.body;
    try {
        const existing = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Proyecto no encontrado' });

        let imagePath = existing.image;
        if (req.files && req.files['image']) {
            imagePath = '/uploads/' + req.files['image'][0].filename;
            if (existing.image && existing.image.startsWith('/uploads/')) {
                const filename = path.basename(existing.image);
                const p1 = path.join(UPLOADS_DIR, filename);
                const p2 = path.join(__dirname, 'public', 'uploads', filename);
                try {
                    if (fs.existsSync(p1)) fs.unlinkSync(p1);
                    else if (fs.existsSync(p2)) fs.unlinkSync(p2);
                } catch (err) {
                    console.warn('No se pudo borrar el archivo físico antiguo:', err.message);
                }
            }
        }

        // Handle extra_media
        let extraMediaUrls = [];
        // Keep existing media that wasn't deleted
        if (kept_extra_media) {
            try {
                extraMediaUrls = JSON.parse(kept_extra_media);
            } catch (err) {
                extraMediaUrls = [];
            }
        }
        // Borrar del disco los archivos que el usuario sacó de la lista (evita huérfanos)
        try {
            const previousExtraMedia = JSON.parse(existing.extra_media || '[]');
            previousExtraMedia
                .filter(url => !extraMediaUrls.includes(url))
                .forEach(url => deleteUploadFile(url));
        } catch (err) { }
        // Add newly uploaded media
        if (req.files && req.files['extra_media']) {
            const newMedia = req.files['extra_media'].map(f => '/uploads/' + f.filename);
            extraMediaUrls = extraMediaUrls.concat(newMedia);
        }
        const extraMediaJson = JSON.stringify(extraMediaUrls);

        const numYear = parseInt(year) || existing.year || new Date().getFullYear();
        const numFeatured = featured !== undefined && featured !== '' ? parseInt(featured) : existing.featured;
        const numVisible = visible !== undefined && visible !== '' ? parseInt(visible) : existing.visible;

        await dbRun(
            'UPDATE projects SET title=?,category=?,description=?,location=?,year=?,image=?,featured=?,visible=?,extra_media=?,status=? WHERE id=?',
            [
                title ? title.trim() : existing.title,
                category ? category.trim() : existing.category,
                description ? description.trim() : existing.description,
                location ? location.trim() : existing.location,
                numYear,
                imagePath,
                numFeatured,
                numVisible,
                extraMediaJson,
                status !== undefined ? status : existing.status,
                req.params.id
            ]
        );
        invalidateProjectsCache();
        res.json({ success: true, image: imagePath });
    } catch (e) {
        console.error('Error actualizando proyecto:', e);
        res.status(500).json({ error: e.message || 'Error al actualizar proyecto' });
    }
});

app.delete(`/${ADMIN_PATH}/api/projects/:id`, requireAuth, async (req, res) => {
    try {
        const project = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.id]);
        if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

        // Borrar imagen principal
        deleteUploadFile(project.image);

        // Borrar archivos extra_media (antes quedaban huérfanos)
        try {
            const extraMedia = JSON.parse(project.extra_media || '[]');
            extraMedia.forEach(url => deleteUploadFile(url));
        } catch (e) { }

        await dbRun('DELETE FROM projects WHERE id = ?', [req.params.id]);
        invalidateProjectsCache();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch(`/${ADMIN_PATH}/api/projects/:id/toggle`, requireAuth, async (req, res) => {
    try {
        const p = await dbGet('SELECT visible FROM projects WHERE id = ?', [req.params.id]);
        if (!p) return res.status(404).json({ error: 'No encontrado' });
        const newVal = p.visible === 1 ? 0 : 1;
        await dbRun('UPDATE projects SET visible = ? WHERE id = ?', [newVal, req.params.id]);
        invalidateProjectsCache();
        res.json({ visible: newVal });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch(`/${ADMIN_PATH}/api/projects/:id/toggle-featured`, requireAuth, async (req, res) => {
    try {
        const p = await dbGet('SELECT featured FROM projects WHERE id = ?', [req.params.id]);
        if (!p) return res.status(404).json({ error: 'No encontrado' });
        const newVal = p.featured === 1 ? 0 : 1;
        await dbRun('UPDATE projects SET featured = ? WHERE id = ?', [newVal, req.params.id]);
        invalidateProjectsCache();
        res.json({ featured: newVal });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API admin: CMS Contenido, Estilos e Imágenes (Con Fusión Segura) ──────────
app.get(`/${ADMIN_PATH}/api/content`, requireAuth, async (req, res) => {
    try {
        const row = await dbGet('SELECT data FROM site_settings WHERE id = 1');
        if (row && row.data) {
            res.json(JSON.parse(row.data));
        } else {
            res.json(DEFAULT_CONTENT);
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put(`/${ADMIN_PATH}/api/content`, requireAuth, async (req, res) => {
    try {
        const data = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Datos inválidos' });
        }
        // Fusión inteligente: nunca sobreescribe con vacío las otras secciones
        const existingRow = await dbGet('SELECT data FROM site_settings WHERE id = 1');
        let current = DEFAULT_CONTENT;
        if (existingRow && existingRow.data) {
            try { current = JSON.parse(existingRow.data); } catch (err) { }
        }
        // Deep merge section_styles (each section is its own object)
        const mergedSectionStyles = { ...(current.section_styles || {}) };
        if (data.section_styles) {
            for (const [sec, vals] of Object.entries(data.section_styles)) {
                mergedSectionStyles[sec] = { ...(mergedSectionStyles[sec] || {}), ...vals };
            }
        }
        const merged = {
            texts: { ...(current.texts || {}), ...(data.texts || {}) },
            styles: { ...(current.styles || {}), ...(data.styles || {}) },
            section_styles: mergedSectionStyles,
            images: { ...(current.images || {}), ...(data.images || {}) },
            video: { ...(current.video || {}), ...(data.video || {}) },
            clients_carousel: { ...(current.clients_carousel || {}), ...(data.clients_carousel || {}) }
        };
        await dbRun(
            'INSERT INTO site_settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
            [JSON.stringify(merged)]
        );
        invalidateContentCache();
        res.json({ success: true, data: merged });
    } catch (e) {
        console.error('Error guardando contenido CMS:', e);
        res.status(500).json({ error: e.message || 'Error al guardar contenidos' });
    }
});

app.post(`/${ADMIN_PATH}/api/upload-asset`, requireAuth, (req, res, next) => {
    upload.single('asset')(req, res, err => {
        if (err) return res.status(400).json({ error: err.message });
        return validateUploadedFiles(req, res, next);
    });
}, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo de imagen' });
    const fileUrl = '/uploads/' + req.file.filename;
    res.json({ success: true, url: fileUrl });
});

// Borra un archivo subido cuando se quita de un slider/carrusel/logo del CMS (evita huérfanos)
app.post(`/${ADMIN_PATH}/api/delete-asset`, requireAuth, (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) {
        return res.status(400).json({ error: 'URL inválida' });
    }
    deleteUploadFile(url);
    res.json({ success: true });
});

// Descarga directa de respaldo completo (.zip con base de datos y uploads)
app.get(`/${ADMIN_PATH}/api/backup-db`, requireAuth, (req, res) => {
    const dbPath = path.join(DATA_DIR, 'nad.db');
    if (!fs.existsSync(dbPath)) {
        return res.status(404).json({ error: 'Base de datos no encontrada' });
    }
    const fecha = new Date().toISOString().slice(0, 10);
    res.attachment(`nad_backup_${fecha}.zip`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
        console.error('Error creando el respaldo:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Error al generar el respaldo' });
    });
    archive.pipe(res);
    archive.file(dbPath, { name: 'nad.db' });
    if (fs.existsSync(UPLOADS_DIR)) {
        archive.directory(UPLOADS_DIR, 'uploads');
    }
    archive.finalize();
});

app.post(`/${ADMIN_PATH}/api/change-password`, requireAuth, async (req, res) => {
    const { current, newPass } = req.body;
    if (!current || !newPass) {
        return res.status(400).json({ error: 'Debes ingresar la contraseña actual y la nueva' });
    }
    if (newPass.length < 12) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 12 caracteres' });
    }
    try {
        const admin = await dbGet('SELECT * FROM admin WHERE id = ?', [req.session.admin.id]);
        if (!admin || !bcrypt.compareSync(current, admin.password))
            return res.status(400).json({ error: 'Contraseña actual incorrecta' });
        const hashed = bcrypt.hashSync(newPass, 10);
        await dbRun('UPDATE admin SET password = ? WHERE id = ?', [hashed, admin.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manejador centralizado de errores para evitar respuestas HTML 500
app.use((err, req, res, next) => {
    console.error('Error no capturado:', err);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'El archivo excede el tamaño máximo permitido (25MB)' });
        }
        return res.status(400).json({ error: 'Error al procesar archivo: ' + err.message });
    }
    res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

// NOTA: /health ya está registrado arriba (línea ~496) — se eliminó el duplicado


// ── Arranque y Cierre Limpio (Railway) ───────────────────────────────────────
// Rutas SEO adicionales

app.get('/sitemap.xml', (req, res) => {
    const DOMAIN = req.protocol + '://' + req.get('host');
    db.all('SELECT id FROM projects WHERE visible = 1', [], (err, rows) => {
        let urls = `<url><loc>${DOMAIN}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
<url><loc>${DOMAIN}/proyectos</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>
`;
        if (!err && rows) {
            rows.forEach(r => {
                urls += `<url><loc>${DOMAIN}/proyecto/${r.id}</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>
`;
            });
        }
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}</urlset>`;
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    });
});

app.get('/robots.txt', (req, res) => {
    const DOMAIN = req.protocol + '://' + req.get('host');
    res.type('text/plain');
    res.send(`User-agent: *
Allow: /
Sitemap: ${DOMAIN}/sitemap.xml`);
});
// -------------------------------

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 NAD Constructora → http://0.0.0.0:${PORT}`);
    console.log(`🔐 Panel admin     → http://0.0.0.0:${PORT}/${ADMIN_PATH}`);
    console.log(`🔒 Ruta secreta    → /${ADMIN_PATH}`);
});

function gracefulShutdown(signal) {
    console.log(`\n🛑 Recibido ${signal}. Cerrando servidor y base de datos...`);
    server.close(() => {
        db.close(err => {
            if (err) console.error('Error cerrando base de datos:', err);
            else console.log('💾 Base de datos cerrada correctamente.');
            process.exit(0);
        });
    });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));



