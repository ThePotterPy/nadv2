'use strict';

class ContentValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ContentValidationError';
        this.statusCode = 400;
    }
}

const TEXT_KEYS = new Set([
    'hero_label', 'hero_title', 'hero_desc', 'hero_btn_projects', 'hero_btn_contact',
    'stats_years_num', 'stats_years_lbl', 'stats_projects_num', 'stats_projects_lbl',
    'stats_clients_num', 'stats_clients_lbl', 'stats_areas_num', 'stats_areas_lbl',
    'services_title', 'services_subtitle',
    'service_1_title', 'service_1_desc', 'service_1_items',
    'service_2_title', 'service_2_desc', 'service_2_items',
    'service_3_title', 'service_3_desc', 'service_3_items',
    'about_badge', 'about_title', 'about_p1', 'about_p2', 'about_director_role',
    'about_director_name', 'about_director_desc', 'about_exp_years', 'about_exp_text',
    'projects_title', 'projects_subtitle', 'btn_ver_mas', 'btn_ver_menos',
    'cta_title', 'cta_subtitle', 'cta_btn_wsp', 'cta_btn_ig', 'cta_btn_ig_link',
    'footer_desc', 'contact_address', 'contact_phone', 'contact_email',
    'contact_instagram', 'contact_instagram_link', 'contact_wsp_link', 'footer_copy'
]);

const FONT_NAMES = new Set([
    'Outfit', 'Inter', 'Roboto', 'Cinzel', 'Montserrat', 'Poppins',
    'Playfair Display', 'MADE TOMMY'
]);

const STYLE_FIELDS = new Map([
    ['font_heading', 'font'], ['font_body', 'font'],
    ['hero_title_size', 'length'], ['h2_size', 'length'], ['body_font_size', 'length'],
    ['color_primary', 'color'], ['color_primary_dark', 'color'], ['color_accent', 'color'],
    ['color_bg', 'color'], ['color_border', 'color'], ['color_info', 'color'],
    ['color_accent_light', 'color']
]);

const SECTION_NAMES = new Set([
    'navbar', 'hero', 'stats', 'services', 'about', 'projects',
    'video', 'clients', 'cta', 'footer'
]);

const SECTION_FIELDS = new Map([
    ['bg_color', 'color'], ['text_color', 'color'], ['heading_color', 'color'],
    ['card_bg', 'color'], ['card_border_color', 'color'], ['link_hover_color', 'color'],
    ['font_heading', 'fontOrEmpty'], ['font_body', 'fontOrEmpty'],
    ['heading_size', 'lengthOrEmpty'], ['body_size', 'lengthOrEmpty'],
    ['overlay_opacity', 'opacityOrEmpty'],
    ['featured_card', 'booleanString'],
    ['hero_glow_enabled', 'booleanString'], ['heading_glow_enabled', 'booleanString'],
    ['hero_glow_color', 'color'], ['heading_glow_color', 'color'],
    ['hero_glow_intensity', 'intensityOrEmpty'], ['heading_glow_intensity', 'intensityOrEmpty']
]);

const IMAGE_FIELDS = new Set([
    'logo', 'hero_bg', 'about_image', 'director_image', 'cta_bg',
    'hero_slider', 'clients_logos'
]);

const VIDEO_FIELDS = new Set(['title', 'description', 'src', 'urls']);
const CLIENT_FIELDS = new Map([
    ['title', 'shortText'], ['title_color', 'color'], ['bg_color', 'color'],
    ['title_size', 'length'], ['logo_height', 'length'],
    ['logo_color_mode', 'logoMode'], ['speed', 'speed'],
    ['gap', 'length'], ['padding', 'length']
]);

const COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const LENGTH_RE = /^(?:0|(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?(?:px|rem|em|%|vw|vh))$/i;
const SAFE_LOCAL_URL_RE = /^\/(?!\/)[A-Za-z0-9._~!$&()*+,;=:@%/\- ]+$/;

function assertPlainObject(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ContentValidationError(`${field} debe ser un objeto`);
    }
}

function assertKnownKeys(value, allowed, field) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            throw new ContentValidationError(`Campo no permitido: ${field}.${key}`);
        }
    }
}

function validateText(value, field, maxLength = 10000) {
    if (typeof value !== 'string') throw new ContentValidationError(`${field} debe ser texto`);
    if (value.length > maxLength) throw new ContentValidationError(`${field} supera el máximo de ${maxLength} caracteres`);
    return value;
}

function validateUrl(value, field, { allowEmpty = true } = {}) {
    const raw = validateText(value, field, 2048).trim();
    if (!raw && allowEmpty) return '';
    if (SAFE_LOCAL_URL_RE.test(raw) && !/[<'"`\\]/.test(raw)) return raw;
    let parsed;
    try { parsed = new URL(raw); } catch (error) {
        throw new ContentValidationError(`${field} contiene una URL inválida`);
    }
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localHttp) {
        throw new ContentValidationError(`${field} debe usar HTTPS o una ruta local`);
    }
    return parsed.href;
}

function validateScalar(type, value, field) {
    if (type === 'font' || type === 'fontOrEmpty') {
        const text = validateText(value, field, 64).trim();
        if (type === 'fontOrEmpty' && text === '') return '';
        if (!FONT_NAMES.has(text)) throw new ContentValidationError(`${field} contiene una fuente no permitida`);
        return text;
    }
    if (type === 'color') {
        const text = validateText(value, field, 9).trim();
        if (!COLOR_RE.test(text)) throw new ContentValidationError(`${field} debe ser un color hexadecimal`);
        return text;
    }
    if (type === 'length' || type === 'lengthOrEmpty') {
        const text = validateText(value, field, 24).trim();
        if (type === 'lengthOrEmpty' && text === '') return '';
        if (!LENGTH_RE.test(text)) throw new ContentValidationError(`${field} contiene una medida CSS inválida`);
        return text;
    }
    if (type === 'opacity' || type === 'opacityOrEmpty') {
        if (type === 'opacityOrEmpty' && value === '') return '';
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0 || number > 1) throw new ContentValidationError(`${field} debe estar entre 0 y 1`);
        return String(number);
    }
    if (type === 'intensity' || type === 'intensityOrEmpty') {
        if (type === 'intensityOrEmpty' && value === '') return '';
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0.3 || number > 2.5) throw new ContentValidationError(`${field} debe estar entre 0.3 y 2.5`);
        return String(number);
    }
    if (type === 'booleanString') {
        if (value !== '0' && value !== '1') throw new ContentValidationError(`${field} debe ser 0 o 1`);
        return value;
    }
    if (type === 'logoMode') {
        if (!['grayscale', 'mix', 'color'].includes(value)) throw new ContentValidationError(`${field} contiene un modo inválido`);
        return value;
    }
    if (type === 'speed') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 5 || number > 120) throw new ContentValidationError(`${field} debe estar entre 5 y 120`);
        return number;
    }
    if (type === 'shortText') return validateText(value, field, 160);
    throw new ContentValidationError(`Validador desconocido para ${field}`);
}

function validateMappedObject(value, schema, field) {
    assertPlainObject(value, field);
    assertKnownKeys(value, new Set(schema.keys()), field);
    const output = {};
    for (const [key, raw] of Object.entries(value)) {
        output[key] = validateScalar(schema.get(key), raw, `${field}.${key}`);
    }
    return output;
}

function validateContentPatch(input) {
    assertPlainObject(input, 'contenido');
    assertKnownKeys(input, new Set(['texts', 'styles', 'section_styles', 'images', 'video', 'clients_carousel']), 'contenido');
    const output = {};

    if (input.texts !== undefined) {
        assertPlainObject(input.texts, 'texts');
        assertKnownKeys(input.texts, TEXT_KEYS, 'texts');
        output.texts = {};
        for (const [key, value] of Object.entries(input.texts)) {
            output.texts[key] = validateText(value, `texts.${key}`);
        }
    }

    if (input.styles !== undefined) output.styles = validateMappedObject(input.styles, STYLE_FIELDS, 'styles');

    if (input.section_styles !== undefined) {
        assertPlainObject(input.section_styles, 'section_styles');
        assertKnownKeys(input.section_styles, SECTION_NAMES, 'section_styles');
        output.section_styles = {};
        for (const [section, values] of Object.entries(input.section_styles)) {
            output.section_styles[section] = validateMappedObject(values, SECTION_FIELDS, `section_styles.${section}`);
        }
    }

    if (input.images !== undefined) {
        assertPlainObject(input.images, 'images');
        assertKnownKeys(input.images, IMAGE_FIELDS, 'images');
        output.images = {};
        for (const [key, value] of Object.entries(input.images)) {
            if (key === 'hero_slider' || key === 'clients_logos') {
                if (!Array.isArray(value) || value.length > 60) throw new ContentValidationError(`images.${key} debe ser una lista de hasta 60 elementos`);
                output.images[key] = value.map((item, index) => validateUrl(item, `images.${key}[${index}]`));
            } else {
                output.images[key] = validateUrl(value, `images.${key}`);
            }
        }
    }

    if (input.video !== undefined) {
        assertPlainObject(input.video, 'video');
        assertKnownKeys(input.video, VIDEO_FIELDS, 'video');
        output.video = {};
        for (const [key, value] of Object.entries(input.video)) {
            if (key === 'urls') {
                if (!Array.isArray(value) || value.length > 30) throw new ContentValidationError('video.urls debe ser una lista de hasta 30 elementos');
                output.video.urls = value.map((item, index) => validateUrl(item, `video.urls[${index}]`));
            } else if (key === 'src') {
                output.video.src = validateUrl(value, 'video.src');
            } else {
                output.video[key] = validateText(value, `video.${key}`, key === 'title' ? 200 : 2000);
            }
        }
    }

    if (input.clients_carousel !== undefined) {
        output.clients_carousel = validateMappedObject(input.clients_carousel, CLIENT_FIELDS, 'clients_carousel');
    }

    return output;
}

module.exports = {
    ContentValidationError,
    validateContentPatch,
    validateUrl,
    FONT_NAMES
};
