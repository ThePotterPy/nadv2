'use strict';

/**
 * Production security guard loaded before server.js.
 *
 * SESSION_SECRET is required on every production start because it signs active
 * sessions. ADMIN_DEFAULT_PASS is different: it is only needed when the
 * database has no administrator yet. server.js handles that one-time bootstrap
 * case, so an already initialized deployment can restart without keeping the
 * initial password in the environment forever.
 */

const isRailway = Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_ENVIRONMENT_ID ||
    process.env.RAILWAY_PROJECT_ID
);
const isProduction = process.env.NODE_ENV === 'production' || isRailway;

if (!isProduction) {
    return;
}

if (!process.env.SESSION_SECRET) {
    console.error('\n❌ Configuración de seguridad incompleta: falta SESSION_SECRET.');
    console.error('El servidor no arrancará en producción hasta configurar esta variable.\n');
    process.exit(1);
}

const sessionSecret = process.env.SESSION_SECRET;
const adminPassword = process.env.ADMIN_DEFAULT_PASS;

const knownWeakSessionSecrets = new Set([
    'nad-secret-2026-xK9mP',
    'cambiar-este-secreto-en-produccion',
    'change-me',
    'secret'
]);

const knownWeakAdminPasswords = new Set([
    'nad2026',
    'admin',
    'password',
    '123456',
    'cambiar-esta-contrasena'
]);

if (sessionSecret.length < 32 || knownWeakSessionSecrets.has(sessionSecret)) {
    console.error('\n❌ SESSION_SECRET es demasiado corto o usa un valor conocido/inseguro.');
    console.error('Usá un secreto aleatorio de al menos 32 caracteres.\n');
    process.exit(1);
}

// If supplied for first-time bootstrap, validate it. It is intentionally not
// mandatory on every restart; server.js only needs it when no admin exists.
if (adminPassword && (adminPassword.length < 12 || knownWeakAdminPasswords.has(adminPassword.toLowerCase()))) {
    console.error('\n❌ ADMIN_DEFAULT_PASS es demasiado corto o usa un valor conocido/inseguro.');
    console.error('Usá una contraseña inicial única de al menos 12 caracteres.\n');
    process.exit(1);
}

if (!process.env.ADMIN_PATH || process.env.ADMIN_PATH === 'gestion-nad-2026' || process.env.ADMIN_PATH === 'reemplazar-por-ruta-admin-no-predecible') {
    console.warn('⚠️  Recomendación: configurá ADMIN_PATH con una ruta administrativa propia (ej: gestion-nad-admin-nosequeponer).');
}
