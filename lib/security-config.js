'use strict';

const crypto = require('crypto');

function isProductionEnvironment() {
    return process.env.NODE_ENV === 'production' || Boolean(
        process.env.RAILWAY_ENVIRONMENT ||
        process.env.RAILWAY_ENVIRONMENT_ID ||
        process.env.RAILWAY_PROJECT_ID
    );
}

function getSessionSecret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

    if (isProductionEnvironment()) {
        throw new Error('SESSION_SECRET es obligatorio en producción');
    }

    // En desarrollo usamos un secreto aleatorio por proceso en vez de una
    // credencial conocida/hardcodeada. Reiniciar el servidor invalida sesiones.
    console.warn('⚠️ SESSION_SECRET no configurado: usando secreto efímero solo para desarrollo.');
    return crypto.randomBytes(48).toString('hex');
}

function getInitialAdminPassword() {
    if (process.env.ADMIN_DEFAULT_PASS) return process.env.ADMIN_DEFAULT_PASS;

    if (isProductionEnvironment()) {
        throw new Error('ADMIN_DEFAULT_PASS es obligatorio en producción al inicializar la base de datos');
    }

    // No crear una cuenta con contraseña predecible en desarrollo tampoco.
    return null;
}

module.exports = {
    getSessionSecret,
    getInitialAdminPassword,
    isProductionEnvironment
};
