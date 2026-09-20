const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const compression = require('compression');
const helmet = require('helmet');
const sharp = require('sharp');
const archiver = require('archiver');
const { getSessionSecret, getInitialAdminPassword, isProductionEnvironment } = require('./lib/security-config');
const SQLiteSessionStore = require('./lib/sqlite-session-store');
const { initializeDatabase, dbGet: migrationDbGet, dbAll: migrationDbAll, dbRun: migrationDbRun } = require('./lib/database-migrations');
const { ContentValidationError, validateContentPatch } = require('./lib/content-validation');
const { prepareBackup } = require('./lib/backup');

sharp.concurrency(Math.max(1, Math.min(2, Number.parseInt(process.env.SHARP_CONCURRENCY || '2', 10) || 2)));

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = (() => {
    const raw = String(process.env.SITE_URL || '').trim().replace(/\/$/, '');
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        if (parsed.protocol === 'https:' || (!isProductionEnvironment() && parsed.protocol === 'http:')) return parsed.origin;
    } catch (error) { }
    throw new Error('SITE_URL debe ser un origen HTTPS válido, sin rutas adicionales');
})();

function publicOrigin(req) {
    return SITE_URL || `${req.protocol}://${req.get('host')}`;
}

// Railway agrega un salto de proxy. Confiar en una cantidad concreta evita que
// el cliente elija libremente req.ip mediante X-Forwarded-For.
const TRUST_PROXY_HOPS = Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
app.set('trust proxy', Number.isInteger(TRUST_PROXY_HOPS) && TRUST_PROXY_HOPS >= 0 ? TRUST_PROXY_HOPS : 1);

// ── Ruta secreta del panel admin ─────────────────────────────────────────────
const rawAdminPath = (process.env.ADMIN_PATH || 'gestion-nad-admin-nosequeponer').trim().replace(/['"]/g, '').replace(/^\/+|\/+$/g, '');
const ADMIN_PATH = (!/^[a-zA-Z0-9_-]{8,100}$/.test(rawAdminPath) || rawAdminPath === 'reemplazar-por-ruta-admin-no-predecible' || rawAdminPath === 'gestion-nad-2026')
    ? 'gestion-nad-admin-nosequeponer'
    : rawAdminPath;

// ── Directorios y Persistencia (Soporte de Railway Volume) ────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
const DATABASE_PATH = path.join(DATA_DIR, 'nad.db');
const DATABASE_WAS_PRESENT = fs.existsSync(DATABASE_PATH) && fs.statSync(DATABASE_PATH).size > 0;
const PERSISTENT_STORAGE_CONFIGURED = Boolean(process.env.DATA_DIR) || !isProductionEnvironment() || process.env.ALLOW_EPHEMERAL_DATA === 'true';

[DATA_DIR, UPLOADS_DIR, path.join(__dirname, 'public', 'uploads')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Base de datos SQLite ─────────────────────────────────────────────────────
const db = new sqlite3.Database(DATABASE_PATH);

const dbGet = (sql, params = []) => migrationDbGet(db, sql, params);
const dbAll = (sql, params = []) => migrationDbAll(db, sql, params);
const dbRun = (sql, params = []) => migrationDbRun(db, sql, params);

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
        logo: '/nad.png',
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

let databaseReadyState = false;
const databaseReady = initializeDatabase(db, {
    databaseWasPresent: DATABASE_WAS_PRESENT,
    initialProjects: INITIAL_PROJECTS,
    defaultContent: DEFAULT_CONTENT,
    getInitialAdminPassword,
    bcrypt
}).then(() => {
    databaseReadyState = true;
    console.log('📀 SQLite listo en modo WAL');
});

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
    limits: {
        fileSize: 25 * 1024 * 1024,
        files: 16,
        fields: 20,
        fieldSize: 64 * 1024,
        parts: 40
    },
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
        let img = sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate(); // respeta orientación EXIF
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
        throw new Error(`No se pudo validar u optimizar la imagen: ${err.message}`);
    }
}

function collectUploadedFiles(req) {
    const files = [];
    if (req.file) files.push(req.file);
    if (req.files) {
        for (const value of Object.values(req.files)) {
            if (Array.isArray(value)) files.push(...value);
        }
    }
    return files;
}

function cleanupUploadedFiles(req) {
    for (const file of collectUploadedFiles(req)) {
        try {
            if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (error) {
            console.warn('No se pudo limpiar un archivo temporal:', error.message);
        }
    }
}

async function validateUploadedFiles(req, res, next) {
    const files = collectUploadedFiles(req);

    try {
        const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
        if (totalBytes > 120 * 1024 * 1024) {
            cleanupUploadedFiles(req);
            return res.status(400).json({ error: 'La carga completa supera el máximo permitido de 120MB.' });
        }

        if (typeof fs.statfsSync === 'function') {
            const stats = fs.statfsSync(UPLOADS_DIR);
            const availableBytes = Number(stats.bavail) * Number(stats.bsize);
            if (Number.isFinite(availableBytes) && availableBytes < Math.max(150 * 1024 * 1024, totalBytes * 2)) {
                cleanupUploadedFiles(req);
                return res.status(507).json({ error: 'No hay espacio suficiente para procesar la carga.' });
            }
        }

        const invalid = files.find(file => !hasUploadSignature(file));
        if (!invalid) {
            // La respuesta no continúa hasta que las imágenes estén completamente
            // escritas. Esto evita servir archivos parciales durante un SIGTERM.
            await Promise.all(files.map(file => {
                const ext = path.extname(file.path || file.filename || '').toLowerCase();
                return optimizeImageOnDisk(file.path, ext);
            }));
            return next();
        }
        cleanupUploadedFiles(req);
        return res.status(400).json({ error: 'El contenido real del archivo no coincide con un formato permitido.' });
    } catch (err) {
        cleanupUploadedFiles(req);
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
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://www.instagram.com'
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://fonts.googleapis.com'
            ],
            fontSrc: [
                "'self'",
                'data:',
                'https://fonts.gstatic.com'
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
app.use(express.json({ limit: '1mb', strict: true }));
app.use(express.urlencoded({ extended: true, limit: '256kb', parameterLimit: 200 }));

// Servir archivos estáticos de uploads tanto desde UPLOADS_DIR (Volumen) como fallback
// Los nombres de archivo subidos son únicos (timestamp + random) y nunca se reutilizan,
// así que se pueden cachear en el navegador por mucho tiempo sin riesgo de servir algo viejo.
const UPLOADS_CACHE = { maxAge: '30d', immutable: true };
app.use('/uploads', express.static(UPLOADS_DIR, UPLOADS_CACHE));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), UPLOADS_CACHE));
app.use('/public', express.static(path.join(__dirname, 'public'), UPLOADS_CACHE));
const VENDOR_CACHE = { maxAge: '30d', immutable: true };
app.use('/vendor/lucide', express.static(path.join(__dirname, 'node_modules', 'lucide', 'dist', 'umd'), VENDOR_CACHE));
app.use('/vendor/swiper', express.static(path.join(__dirname, 'node_modules', 'swiper'), VENDOR_CACHE));
app.use('/vendor/plyr', express.static(path.join(__dirname, 'node_modules', 'plyr', 'dist'), VENDOR_CACHE));
app.use('/vendor/fontawesome', express.static(path.join(__dirname, 'node_modules', '@fortawesome', 'fontawesome-free'), VENDOR_CACHE));
// --- SEO & Dynamic Rendering ---
const defaultMeta = {
    title: 'NAD Constructora | Arquitectura, Diseño y Construcción',
    desc: 'NAD Constructora ofrece servicios integrales de estudio de factibilidad, proyecto arquitectónico y construcción en Paraguay. Calidad, compromiso y excelencia técnica en cada obra.',
    image: '/nad.png',
    url: '/'
};

function applyPublicCsp(res, nonce) {
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' https://www.instagram.com`,
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        "frame-src 'self' https://www.youtube.com https://youtube.com https://www.youtube-nocookie.com https://www.instagram.com https://www.google.com",
        "connect-src 'self' https://www.instagram.com https://graph.instagram.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'"
    ].join('; '));
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeProjectInput(body, existing = null) {
    const requiredText = (name, maxLength) => {
        const incoming = body[name];
        const value = incoming === undefined && existing ? existing[name] : incoming;
        if (typeof value !== 'string' || !value.trim()) throw new ContentValidationError(`El campo ${name} es obligatorio`);
        const trimmed = value.trim();
        if (trimmed.length > maxLength) throw new ContentValidationError(`El campo ${name} es demasiado largo`);
        return trimmed;
    };
    const yearValue = body.year === undefined && existing ? existing.year : Number.parseInt(body.year, 10);
    const maxYear = new Date().getFullYear() + 10;
    if (!Number.isInteger(Number(yearValue)) || Number(yearValue) < 1900 || Number(yearValue) > maxYear) {
        throw new ContentValidationError(`El año debe estar entre 1900 y ${maxYear}`);
    }
    const booleanField = name => {
        const incoming = body[name];
        const value = incoming === undefined
            ? (existing ? existing[name] : 1)
            : Number.parseInt(incoming, 10);
        if (value !== 0 && value !== 1) throw new ContentValidationError(`${name} debe ser 0 o 1`);
        return value;
    };
    const status = body.status === undefined && existing ? existing.status : (body.status || 'Terminado');
    if (!['Terminado', 'En Curso'].includes(status)) throw new ContentValidationError('Estado de proyecto inválido');
    return {
        title: requiredText('title', 200),
        category: requiredText('category', 160),
        description: requiredText('description', 20000),
        location: requiredText('location', 200),
        year: Number(yearValue),
        featured: booleanField('featured'),
        visible: booleanField('visible'),
        status
    };
}

function parseMediaList(value) {
    if (!value) return [];
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) throw new ContentValidationError('La galería del proyecto es inválida');
    return parsed;
}

function contentContainsUrl(value, url) {
    if (value === url) return true;
    if (Array.isArray(value)) return value.some(item => contentContainsUrl(item, url));
    if (value && typeof value === 'object') return Object.values(value).some(item => contentContainsUrl(item, url));
    return false;
}

async function isUploadReferenced(url) {
    const primary = await dbGet('SELECT id FROM projects WHERE image = ? LIMIT 1', [url]);
    if (primary) return true;
    const projects = await dbAll("SELECT extra_media FROM projects WHERE extra_media LIKE '%/uploads/%'");
    for (const project of projects) {
        try {
            if (parseMediaList(project.extra_media).includes(url)) return true;
        } catch (error) { }
    }
    const content = await getContent();
    return contentContainsUrl(content, url);
}

function escapeCssString(value) {
    return String(value == null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\\27 ')
        .replace(/"/g, '\\22 ')
        .replace(/</g, '\\3c ')
        .replace(/>/g, '\\3e ')
        .replace(/[\r\n\f]/g, ' ');
}

function mergeContent(current, patch) {
    const mergedSectionStyles = { ...(current.section_styles || {}) };
    if (patch.section_styles) {
        for (const [section, values] of Object.entries(patch.section_styles)) {
            mergedSectionStyles[section] = { ...(mergedSectionStyles[section] || {}), ...values };
        }
    }
    return {
        texts: { ...(current.texts || {}), ...(patch.texts || {}) },
        styles: { ...(current.styles || {}), ...(patch.styles || {}) },
        section_styles: mergedSectionStyles,
        images: { ...(current.images || {}), ...(patch.images || {}) },
        video: { ...(current.video || {}), ...(patch.video || {}) },
        clients_carousel: { ...(current.clients_carousel || {}), ...(patch.clients_carousel || {}) }
    };
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
let cachedContentAt = 0;
let cachedPublicProjectsAt = 0;
const CACHE_TTL_MS = 5000;
function invalidateContentCache() { cachedContent = null; cachedContentAt = 0; }
function invalidateProjectsCache() { cachedPublicProjects = null; cachedPublicProjectsAt = 0; }

async function getContent() {
    if (cachedContent && Date.now() - cachedContentAt < CACHE_TTL_MS) return cachedContent;
    const row = await dbGet('SELECT data FROM site_settings WHERE id = 1');
    if (!row || !row.data) {
        cachedContent = DEFAULT_CONTENT;
        cachedContentAt = Date.now();
        return cachedContent;
    }
    try {
        const parsed = JSON.parse(row.data);
        const validated = validateContentPatch(parsed);
        cachedContent = mergeContent(DEFAULT_CONTENT, validated);
    } catch (error) {
        console.error('Contenido CMS inválido almacenado; se usarán valores seguros:', error.message);
        cachedContent = DEFAULT_CONTENT;
    }
    cachedContentAt = Date.now();
    return cachedContent;
}

async function getPublicProjects() {
    if (cachedPublicProjects && Date.now() - cachedPublicProjectsAt < CACHE_TTL_MS) return cachedPublicProjects;
    cachedPublicProjects = await dbAll('SELECT * FROM projects WHERE visible = 1 ORDER BY featured DESC, year DESC, id DESC');
    cachedPublicProjectsAt = Date.now();
    return cachedPublicProjects;
}

async function renderPageWithMeta(filename, req, res, metaOverride = {}) {
    const DOMAIN = publicOrigin(req);
    const meta = { ...defaultMeta, ...metaOverride };
    const cspNonce = crypto.randomBytes(18).toString('base64');

    try {
        // Obtener config para inyectar CSS variables y evitar FOUC
        const config = await getContent();
        const stylesData = config ? config.styles : null;
        let html = getHtmlTemplate(filename);
        html = html.replace(/<script type="application\/ld\+json">/g, `<script type="application/ld+json" nonce="${cspNonce}">`);

        // Inyectar imágenes del CMS para evitar FOUC y flashes de imágenes por defecto
        const sliderImgs = (config && config.images && Array.isArray(config.images.hero_slider) && config.images.hero_slider.length > 0)
            ? config.images.hero_slider.map(safePublicMediaUrl).filter(Boolean)
            : [];
        const firstHeroImg = sliderImgs[0] || (config && config.images && safePublicMediaUrl(config.images.hero_bg)) || '';

        let heroImageCss = '';
        if (firstHeroImg) {
            html = html.replace(
                '<div class="hero-bg slide active" id="cms-hero-bg"></div>',
                `<div class="hero-bg slide active" id="cms-hero-bg" style="background-image: url('${escapeCssString(firstHeroImg)}');"></div>`
            );
            const preloadTag = `<link rel="preload" as="image" href="${escapeHtml(firstHeroImg)}" fetchpriority="high">`;
            html = html.replace('</head>', `    ${preloadTag}\n</head>`);
            heroImageCss = `#cms-hero-bg { background-image: url('${escapeCssString(firstHeroImg)}') !important; }`;
        }

        if (config && config.images && config.images.cta_bg) {
            const ctaBg = safePublicMediaUrl(config.images.cta_bg);
            if (ctaBg) {
                heroImageCss += ` .cta-section { background-image: url('${escapeCssString(ctaBg)}') !important; }`;
            }
        }

        if (config && config.images && config.images.logo) {
            const logoUrl = safePublicMediaUrl(config.images.logo);
            if (logoUrl) {
                html = html.replace(/src="\/?nad\.png" alt="NAD Constructora Logo" id="site-logo"/, `src="${escapeHtml(logoUrl)}" alt="NAD Constructora Logo" id="site-logo"`);
                html = html.replace(/src="\/?nad\.png" alt="NAD Constructora Logo" class="footer-logo" id="cms-footer-logo"/, `src="${escapeHtml(logoUrl)}" alt="NAD Constructora Logo" class="footer-logo" id="cms-footer-logo"`);
            }
        }

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
                        vars += `--sec-font-heading:'${escapeCssString(s.font_heading)}', sans-serif;`;
                        allUsedFonts.add(s.font_heading);
                    }
                    if (s.font_body) {
                        vars += `--sec-font-body:'${escapeCssString(s.font_body)}', sans-serif;`;
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
                const gFontsUrl = Array.from(allUsedFonts).map(f => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800`).join('&');

                const dynamicStyle = `
                <link id="dynamic-fonts" href="https://fonts.googleapis.com/css2?${escapeHtml(gFontsUrl)}&amp;display=swap" rel="stylesheet">
                <style>
                    :root {
                        --font-heading: '${escapeCssString(stylesData.font_heading)}', sans-serif;
                        --font-body: '${escapeCssString(stylesData.font_body)}', sans-serif;
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
                    ${heroImageCss}
                </style>`;
                html = html.replace('</head>', `${dynamicStyle}\n</head>`);
            } else if (heroImageCss) {
                html = html.replace('</head>', `<style>${heroImageCss}</style>\n</head>`);
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

            applyPublicCsp(res, cspNonce);
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

async function renderProjectPage(req, res, row) {
    const domain = publicOrigin(req);
    const content = await getContent();
    const logoUrl = safePublicMediaUrl(content?.images?.logo) || '/nad.png';
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
        '{{LOGO_URL}}': escapeHtml(logoUrl),
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

    applyPublicCsp(res, crypto.randomBytes(18).toString('base64'));
    res.type('html').send(html);
}

app.get('/proyecto/:id', async (req, res) => {
    try {
        const row = await dbGet('SELECT * FROM projects WHERE id = ? AND visible = 1', [req.params.id]);
        if (!row) return res.status(404).send('Proyecto no encontrado');
        return await renderProjectPage(req, res, row);
    } catch (error) {
        console.error('Error cargando proyecto:', error);
        return res.status(500).send('Error interno');
    }
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

const sessionStore = new SQLiteSessionStore(db);
app.use(session({
    name: 'nad.sid',
    store: sessionStore,
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
    const origin = req.get('origin');
    const referer = req.get('referer');
    const source = origin || referer;

    if (!source) {
        return res.status(403).json({ error: 'Origen de solicitud no permitido' });
    }

    try {
        const sourceUrl = new URL(source);
        const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
        const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
        const requestOrigin = `${req.protocol}://${req.get('host')}`;
        const allowedOrigins = new Set(SITE_URL
            ? [SITE_URL]
            : [
                requestOrigin,
                forwardedHost ? `${forwardedProto || req.protocol}://${forwardedHost}` : null
            ].filter(Boolean));
        if (allowedOrigins.has(sourceUrl.origin)) return next();
    } catch (err) { }

    return res.status(403).json({ error: 'Origen de solicitud no permitido' });
}

// Rate limiting para login (máx 5 intentos por IP + usuario, bloqueo 15 min)
function loginAttemptKey(ip, username) {
    return `${String(ip || 'unknown').slice(0, 128)}|${String(username || '').trim().toLowerCase().slice(0, 100)}`;
}

async function cleanupLoginAttempts() {
    await dbRun("DELETE FROM login_attempts WHERE updated_at < datetime('now', '-7 days')");
}

async function checkRateLimit(key) {
    const now = new Date();
    const record = await dbGet('SELECT * FROM login_attempts WHERE ip = ?', [key]);

    if (record) {
        if (record.locked_until && new Date(record.locked_until) > now) {
            const secs = Math.ceil((new Date(record.locked_until) - now) / 1000);
            return { blocked: true, seconds: secs };
        }
        if (record.locked_until) {
            await dbRun('UPDATE login_attempts SET locked_until = NULL, attempts = 0, updated_at = datetime(\'now\') WHERE ip = ?', [key]);
        }
    }
    return { blocked: false };
}

async function recordFailedAttempt(key) {
    await dbRun(
        `INSERT INTO login_attempts (ip, attempts, locked_until, updated_at)
         VALUES (?, 1, NULL, datetime('now'))
         ON CONFLICT(ip) DO UPDATE SET
            attempts = CASE WHEN login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= datetime('now') THEN 1 ELSE login_attempts.attempts + 1 END,
            locked_until = CASE WHEN login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= datetime('now') THEN NULL ELSE login_attempts.locked_until END,
            updated_at = datetime('now')`,
        [key]
    );
    const record = await dbGet('SELECT attempts FROM login_attempts WHERE ip = ?', [key]);
    if (record && record.attempts >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await dbRun(
            'UPDATE login_attempts SET locked_until = ?, attempts = 0, updated_at = datetime(\'now\') WHERE ip = ?',
            [lockUntil, key]
        );
        return { blocked: true, seconds: 900, remaining: 0 };
    }
    return { blocked: false, remaining: Math.max(0, 5 - (record ? record.attempts : 1)) };
}

async function resetAttempts(key) {
    await dbRun('DELETE FROM login_attempts WHERE ip = ?', [key]);
}

// ── Rutas Públicas ───────────────────────────────────────────────────────────


async function readinessReport() {
    const checks = {
        database: 'error',
        storage: 'error',
        persistence: PERSISTENT_STORAGE_CONFIGURED ? 'ok' : 'not_configured'
    };
    try {
        if (databaseReadyState) {
            await dbGet('SELECT 1 AS ok');
            checks.database = 'ok';
        }
    } catch (error) {
        checks.database = 'error';
    }
    try {
        fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
        fs.accessSync(UPLOADS_DIR, fs.constants.R_OK | fs.constants.W_OK);
        checks.storage = 'ok';
    } catch (error) {
        checks.storage = 'error';
    }
    const ready = checks.database === 'ok' && checks.storage === 'ok' && checks.persistence === 'ok';
    return { ready, checks };
}

app.get('/health/live', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));
app.get(['/health', '/health/ready'], async (req, res) => {
    const report = await readinessReport();
    res.status(report.ready ? 200 : 503).json({
        status: report.ready ? 'ok' : 'unavailable',
        uptime: process.uptime(),
        checks: report.checks
    });
});

// API pública
app.get('/api/projects', async (req, res) => {
    try {
        const rows = await getPublicProjects();
        res.json(rows);
    } catch (e) {
        console.error('Error cargando proyectos públicos:', e);
        res.status(500).json({ error: 'No se pudieron cargar los proyectos' });
    }
});

app.get('/api/content', async (req, res) => {
    try {
        res.json(await getContent());
    } catch (e) {
        res.json(DEFAULT_CONTENT);
    }
});

// ── Rutas del Panel Admin (Ruta secreta) ────────────────────────────────────
app.get([`/${ADMIN_PATH}/login`, `/${ADMIN_PATH}/login/`], (req, res) => {
    if (req.session.admin) return res.redirect(`/${ADMIN_PATH}`);
    res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.post([`/${ADMIN_PATH}/login`, `/${ADMIN_PATH}/login/`], requireSameOrigin, async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    try {
        const username = typeof req.body.username === 'string' ? req.body.username.trim().slice(0, 100) : '';
        const password = typeof req.body.password === 'string' ? req.body.password : '';
        const attemptKey = loginAttemptKey(ip, username);
        await cleanupLoginAttempts();
        const limit = await checkRateLimit(attemptKey);
        if (limit.blocked) {
            const mins = Math.ceil(limit.seconds / 60);
            return res.redirect(`/${ADMIN_PATH}/login?error=blocked&mins=${mins}`);
        }

        const admin = username && password
            ? await dbGet('SELECT * FROM admin WHERE username = ?', [username])
            : null;
        const validPassword = admin ? await bcrypt.compare(password, admin.password) : false;

        if (!admin || !validPassword) {
            const failure = await recordFailedAttempt(attemptKey);
            if (failure.blocked) {
                return res.redirect(`/${ADMIN_PATH}/login?error=blocked&mins=15`);
            }
            return res.redirect(`/${ADMIN_PATH}/login?error=1&remaining=${failure.remaining}`);
        }

        await resetAttempts(attemptKey);
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

app.get([`/${ADMIN_PATH}`, `/${ADMIN_PATH}/`], requireAuth, (req, res) => {
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
    } catch (e) {
        console.error('Error cargando proyectos administrativos:', e);
        res.status(500).json({ error: 'No se pudieron cargar los proyectos' });
    }
});

app.post(`/${ADMIN_PATH}/api/projects`, requireAuth, (req, res, next) => {
    upload.fields([{ name: 'image', maxCount: 1 }, { name: 'extra_media', maxCount: 15 }])(req, res, err => {
        if (err) return res.status(400).json({ error: err.message });
        return validateUploadedFiles(req, res, next);
    });
}, async (req, res) => {
    try {
        if (!req.files || !req.files['image']) {
            cleanupUploadedFiles(req);
            return res.status(400).json({ error: 'Se requiere una imagen o video para el proyecto' });
        }
        const project = normalizeProjectInput(req.body);
        const imagePath = '/uploads/' + req.files['image'][0].filename;
        const extraMediaUrls = req.files['extra_media']
            ? req.files['extra_media'].map(file => '/uploads/' + file.filename)
            : [];
        const result = await dbRun(
            'INSERT INTO projects (title, category, description, location, year, image, featured, visible, extra_media, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [
                project.title, project.category, project.description, project.location,
                project.year, imagePath, project.featured, project.visible,
                JSON.stringify(extraMediaUrls), project.status
            ]
        );
        invalidateProjectsCache();
        res.status(201).json({ id: result.lastID, image: imagePath });
    } catch (e) {
        cleanupUploadedFiles(req);
        if (e instanceof ContentValidationError) return res.status(400).json({ error: e.message });
        console.error('Error creando proyecto:', e);
        res.status(500).json({ error: 'Error al guardar proyecto' });
    }
});

app.put(`/${ADMIN_PATH}/api/projects/:id`, requireAuth, (req, res, next) => {
    upload.fields([{ name: 'image', maxCount: 1 }, { name: 'extra_media', maxCount: 15 }])(req, res, err => {
        if (err) return res.status(400).json({ error: err.message });
        return validateUploadedFiles(req, res, next);
    });
}, async (req, res) => {
    try {
        const existing = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.id]);
        if (!existing) {
            cleanupUploadedFiles(req);
            return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        const project = normalizeProjectInput(req.body, existing);

        let imagePath = existing.image;
        if (req.files && req.files['image']) {
            imagePath = '/uploads/' + req.files['image'][0].filename;
        }

        const previousExtraMedia = parseMediaList(existing.extra_media || '[]');
        let extraMediaUrls = req.body.kept_extra_media
            ? parseMediaList(req.body.kept_extra_media)
            : previousExtraMedia.slice();
        if (!extraMediaUrls.every(url => previousExtraMedia.includes(url))) {
            throw new ContentValidationError('La lista de archivos conservados contiene elementos inválidos');
        }
        if (req.files && req.files['extra_media']) {
            const newMedia = req.files['extra_media'].map(f => '/uploads/' + f.filename);
            extraMediaUrls = extraMediaUrls.concat(newMedia);
        }
        if (extraMediaUrls.length > 60) throw new ContentValidationError('La galería supera el máximo de 60 archivos');

        await dbRun(
            'UPDATE projects SET title=?,category=?,description=?,location=?,year=?,image=?,featured=?,visible=?,extra_media=?,status=? WHERE id=?',
            [
                project.title,
                project.category,
                project.description,
                project.location,
                project.year,
                imagePath,
                project.featured,
                project.visible,
                JSON.stringify(extraMediaUrls),
                project.status,
                req.params.id
            ]
        );
        if (imagePath !== existing.image) deleteUploadFile(existing.image);
        previousExtraMedia
            .filter(url => !extraMediaUrls.includes(url))
            .forEach(url => deleteUploadFile(url));
        invalidateProjectsCache();
        res.json({ success: true, image: imagePath });
    } catch (e) {
        cleanupUploadedFiles(req);
        if (e instanceof ContentValidationError || e instanceof SyntaxError) {
            return res.status(400).json({ error: e.message || 'Datos inválidos' });
        }
        console.error('Error actualizando proyecto:', e);
        res.status(500).json({ error: 'Error al actualizar proyecto' });
    }
});

app.delete(`/${ADMIN_PATH}/api/projects/:id`, requireAuth, async (req, res) => {
    try {
        const project = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.id]);
        if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

        await dbRun('DELETE FROM projects WHERE id = ?', [req.params.id]);
        deleteUploadFile(project.image);
        try {
            parseMediaList(project.extra_media || '[]').forEach(url => deleteUploadFile(url));
        } catch (e) { }
        invalidateProjectsCache();
        res.json({ success: true });
    } catch (e) {
        console.error('Error eliminando proyecto:', e);
        res.status(500).json({ error: 'Error al eliminar proyecto' });
    }
});

app.patch(`/${ADMIN_PATH}/api/projects/:id/toggle`, requireAuth, async (req, res) => {
    try {
        const p = await dbGet('SELECT visible FROM projects WHERE id = ?', [req.params.id]);
        if (!p) return res.status(404).json({ error: 'No encontrado' });
        const newVal = p.visible === 1 ? 0 : 1;
        await dbRun('UPDATE projects SET visible = ? WHERE id = ?', [newVal, req.params.id]);
        invalidateProjectsCache();
        res.json({ visible: newVal });
    } catch (e) {
        console.error('Error cambiando visibilidad:', e);
        res.status(500).json({ error: 'No se pudo cambiar la visibilidad' });
    }
});

app.patch(`/${ADMIN_PATH}/api/projects/:id/toggle-featured`, requireAuth, async (req, res) => {
    try {
        const p = await dbGet('SELECT featured FROM projects WHERE id = ?', [req.params.id]);
        if (!p) return res.status(404).json({ error: 'No encontrado' });
        const newVal = p.featured === 1 ? 0 : 1;
        await dbRun('UPDATE projects SET featured = ? WHERE id = ?', [newVal, req.params.id]);
        invalidateProjectsCache();
        res.json({ featured: newVal });
    } catch (e) {
        console.error('Error cambiando clasificación:', e);
        res.status(500).json({ error: 'No se pudo cambiar la clasificación' });
    }
});

// ── API admin: CMS Contenido, Estilos e Imágenes (Con Fusión Segura) ──────────
app.get(`/${ADMIN_PATH}/api/content`, requireAuth, async (req, res) => {
    try {
        res.json(await getContent());
    } catch (e) {
        console.error('Error leyendo contenido CMS:', e);
        res.status(500).json({ error: 'No se pudo leer el contenido del sitio' });
    }
});

app.put(`/${ADMIN_PATH}/api/content`, requireAuth, async (req, res) => {
    try {
        const patch = validateContentPatch(req.body);
        const current = await getContent();
        const merged = validateContentPatch(mergeContent(current, patch));
        await dbRun(
            'INSERT INTO site_settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
            [JSON.stringify(merged)]
        );
        invalidateContentCache();
        res.json({ success: true, data: merged });
    } catch (e) {
        if (e instanceof ContentValidationError) {
            return res.status(400).json({ error: e.message });
        }
        console.error('Error guardando contenido CMS:', e);
        res.status(500).json({ error: 'Error al guardar contenidos' });
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
    isUploadReferenced(url).then(referenced => {
        if (referenced) return res.status(409).json({ error: 'El archivo todavía está en uso' });
        deleteUploadFile(url);
        return res.json({ success: true });
    }).catch(error => {
        console.error('Error comprobando referencias del archivo:', error);
        res.status(500).json({ error: 'No se pudo eliminar el archivo' });
    });
});

// Descarga directa de respaldo completo (.zip con base de datos y uploads)
app.get(`/${ADMIN_PATH}/api/backup-db`, requireAuth, async (req, res) => {
    let prepared;
    try {
        prepared = await prepareBackup({ db, uploadsDir: UPLOADS_DIR });
        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Cache-Control', 'no-store');
        res.attachment(`nad_backup_${date}.zip`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        let cleaned = false;
        const cleanup = async () => {
            if (cleaned) return;
            cleaned = true;
            await prepared.cleanup().catch(error => console.warn('No se pudo limpiar el backup temporal:', error.message));
        };
        archive.on('error', async error => {
            console.error('Error creando el respaldo:', error);
            await cleanup();
            if (!res.headersSent) res.status(500).json({ error: 'Error al generar el respaldo' });
            else res.destroy(error);
        });
        res.once('close', cleanup);
        archive.pipe(res);
        archive.file(prepared.snapshotPath, { name: 'nad.db' });
        if (fs.existsSync(prepared.uploadsSnapshot)) {
            archive.directory(prepared.uploadsSnapshot, 'uploads');
        }
        await archive.finalize();
    } catch (error) {
        if (prepared) await prepared.cleanup().catch(() => {});
        console.error('Error creando el respaldo:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Error al generar el respaldo' });
    }
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
        if (!admin || !(await bcrypt.compare(current, admin.password)))
            return res.status(400).json({ error: 'Contraseña actual incorrecta' });
        const hashed = await bcrypt.hash(newPass, 12);
        await dbRun('UPDATE admin SET password = ? WHERE id = ?', [hashed, admin.id]);
        await dbRun('DELETE FROM sessions');
        req.session.destroy(error => {
            if (error) return res.status(500).json({ error: 'La contraseña cambió, pero no se pudo cerrar la sesión' });
            res.clearCookie('nad.sid');
            return res.json({ success: true, reauthenticate: true });
        });
    } catch (e) {
        console.error('Error cambiando contraseña:', e);
        res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
    }
});

// Manejador centralizado de errores para evitar respuestas HTML 500
app.use((err, req, res, next) => {
    console.error('Error no capturado:', err);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'El archivo excede el tamaño máximo permitido (25MB)' });
        }
        return res.status(400).json({ error: 'Error al procesar el archivo enviado' });
    }
    res.status(500).json({ error: 'Error interno del servidor' });
});

// NOTA: /health ya está registrado arriba (línea ~496) — se eliminó el duplicado


// ── Arranque y Cierre Limpio (Railway) ───────────────────────────────────────
// Rutas SEO adicionales

app.get('/sitemap.xml', (req, res) => {
    const DOMAIN = publicOrigin(req);
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
    const DOMAIN = publicOrigin(req);
    res.type('text/plain');
    res.send(`User-agent: *
Allow: /
Sitemap: ${DOMAIN}/sitemap.xml`);
});
// -------------------------------

let server = null;
let shuttingDown = false;

databaseReady.then(() => {
    if (!PERSISTENT_STORAGE_CONFIGURED) {
        console.error('❌ DATA_DIR no está configurado en producción. /health permanecerá en 503 para impedir un deploy con almacenamiento efímero.');
    }
    server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 NAD Constructora → http://0.0.0.0:${PORT}`);
        console.log(`🔐 Panel administrativo habilitado en la ruta configurada`);
    });
}).catch(error => {
    console.error('❌ No se pudo inicializar la base de datos:', error);
    process.exitCode = 1;
    db.close(() => process.exit(1));
});

function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    databaseReadyState = false;
    console.log(`\n🛑 Recibido ${signal}. Cerrando servidor y base de datos...`);
    const forceTimer = setTimeout(() => {
        console.error('El cierre superó 10 segundos; se fuerza la salida.');
        process.exit(1);
    }, 10_000);
    forceTimer.unref();

    const closeDatabase = () => {
        sessionStore.close();
        db.close(error => {
            clearTimeout(forceTimer);
            if (error) {
                console.error('Error cerrando base de datos:', error);
                process.exit(1);
            }
            console.log('💾 Base de datos cerrada correctamente.');
            process.exit(0);
        });
    };

    if (server) server.close(closeDatabase);
    else closeDatabase();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));



