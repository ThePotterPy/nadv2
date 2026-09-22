'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.resolve(__dirname, '..');
const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
    'base64'
);

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function waitForReady(baseUrl, child) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`El servidor terminó con código ${child.exitCode}`);
        try {
            const response = await fetch(`${baseUrl}/health`);
            if (response.ok) return;
        } catch (error) { }
        await pause(100);
    }
    throw new Error('El servidor de prueba no quedó listo');
}

async function startApplication(dataDir, credentials) {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['-r', './security-bootstrap.js', 'server.js'], {
        cwd: ROOT,
        env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: 'test',
            DATA_DIR: dataDir,
            UPLOADS_DIR: path.join(dataDir, 'uploads'),
            ADMIN_PATH: 'audit-panel',
            SITE_URL: baseUrl,
            SESSION_SECRET: credentials.secret,
            ADMIN_DEFAULT_PASS: credentials.password
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForReady(baseUrl, child);
    return { child, baseUrl };
}

async function stopApplication(child) {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        pause(4000)
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
}

async function login(baseUrl, password) {
    const response = await fetch(`${baseUrl}/audit-panel/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
            origin: baseUrl,
            'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ username: 'admin', password })
    });
    assert.equal(response.status, 302);
    const cookie = (response.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookie, /^nad\.sid=/);
    return cookie;
}

test('la portada define un fondo oscuro antes de cargar estilos externos', () => {
    const homepage = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const criticalStyle = homepage.indexOf('id="critical-first-paint"');
    const externalStylesheet = homepage.indexOf('href="/styles.css"');

    assert.ok(criticalStyle > -1, 'falta el estilo crítico del primer render');
    assert.ok(criticalStyle < externalStylesheet, 'el fondo crítico debe llegar antes que la hoja CSS');
    assert.match(homepage, /html,\s*body\s*\{\s*background(?:-color)?:\s*#1a0305/i);
    assert.match(homepage, /\.hero\s*\{\s*background(?:-color)?:\s*#1a0305/i);
});

function readSetting(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath);
        db.get('SELECT data FROM site_settings WHERE id = 1', (error, row) => {
            db.close();
            if (error) reject(error);
            else resolve(JSON.parse(row.data));
        });
    });
}

test('regresiones críticas del CMS, backup, archivos, salud y semillas', { timeout: 45000 }, async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nad-regression-'));
    const dataDir = path.join(tempRoot, 'data');
    fs.mkdirSync(dataDir);
    const credentials = {
        secret: crypto.randomBytes(48).toString('hex'),
        password: `audit-${crypto.randomBytes(24).toString('hex')}`
    };
    let application;

    t.after(async () => {
        if (application) await stopApplication(application.child);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    application = await startApplication(dataDir, credentials);
    let cookie = await login(application.baseUrl, credentials.password);

    await t.test('rechaza valores de estilo capaces de salir del bloque CSS', async () => {
        const payload = {
            styles: {
                font_heading: 'AuditFont"></style><meta name="audit-injected" content="1"><style x="'
            }
        };
        const response = await fetch(`${application.baseUrl}/audit-panel/api/content`, {
            method: 'PUT',
            headers: { origin: application.baseUrl, cookie, 'content-type': 'application/json' },
            body: JSON.stringify(payload)
        });
        assert.equal(response.status, 400);
        const homepage = await (await fetch(`${application.baseUrl}/`)).text();
        assert.equal(homepage.includes('audit-injected'), false);
    });

    await t.test('el backup contiene una instantánea SQLite restaurable con cambios WAL recientes', async () => {
        const marker = `backup-${crypto.randomBytes(8).toString('hex')}`;
        const update = await fetch(`${application.baseUrl}/audit-panel/api/content`, {
            method: 'PUT',
            headers: { origin: application.baseUrl, cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ texts: { footer_desc: marker } })
        });
        assert.equal(update.status, 200);

        const response = await fetch(`${application.baseUrl}/audit-panel/api/backup-db`, {
            headers: { cookie }
        });
        assert.equal(response.status, 200);
        const zipPath = path.join(tempRoot, 'backup.zip');
        fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
        const extractDir = path.join(tempRoot, 'backup');
        fs.mkdirSync(extractDir);
        const tarExecutable = process.platform === 'win32'
            ? 'C:\\Windows\\System32\\tar.exe'
            : 'tar';
        const extraction = spawnSync(tarExecutable, ['-xf', zipPath, '-C', extractDir], { encoding: 'utf8' });
        assert.equal(extraction.status, 0, extraction.stderr || extraction.error?.message);
        const restored = await readSetting(path.join(extractDir, 'nad.db'));
        assert.equal(restored.texts.footer_desc, marker);
    });

    await t.test('limpia archivos subidos cuando el proyecto es inválido', async () => {
        const body = new FormData();
        body.append('image', new Blob([PNG_1X1], { type: 'image/png' }), 'test.png');
        body.append('category', 'Prueba');
        body.append('description', 'Descripción');
        body.append('location', 'Asunción');
        body.append('year', '2026');
        const response = await fetch(`${application.baseUrl}/audit-panel/api/projects`, {
            method: 'POST',
            headers: { origin: application.baseUrl, cookie },
            body
        });
        assert.equal(response.status, 400);
        const uploads = fs.readdirSync(path.join(dataDir, 'uploads'));
        assert.deepEqual(uploads, []);
    });

    await t.test('health comprueba base y almacenamiento', async () => {
        const response = await fetch(`${application.baseUrl}/health`);
        assert.equal(response.status, 200);
        const health = await response.json();
        assert.equal(health.status, 'ok');
        assert.equal(health.checks.database, 'ok');
        assert.equal(health.checks.storage, 'ok');
    });

    await t.test('sirve las dependencias frontend localmente y sin referencias a CDN', async () => {
        const homepageResponse = await fetch(`${application.baseUrl}/`);
        const homepage = await homepageResponse.text();
        assert.match(homepage, /\/vendor\/lucide\/lucide\.min\.js/);
        assert.equal(/(?:unpkg|cdn\.jsdelivr|cdnjs\.cloudflare|cdn\.plyr)\.com/.test(homepage), false);
        const csp = homepageResponse.headers.get('content-security-policy') || '';
        const scriptDirective = csp.split(';').find(part => part.trim().startsWith('script-src ')) || '';
        assert.equal(scriptDirective.includes("'unsafe-inline'"), false);
        assert.match(csp, /script-src-attr 'none'/);
        for (const asset of [
            '/vendor/lucide/lucide.min.js',
            '/vendor/swiper/swiper-bundle.min.css',
            '/vendor/plyr/plyr.polyfilled.js',
            '/vendor/fontawesome/css/all.min.css'
        ]) {
            const response = await fetch(application.baseUrl + asset);
            assert.equal(response.status, 200, asset);
        }
    });

    await t.test('la página individual usa el logo actual del CMS desde el primer HTML', async () => {
        const logoUrl = '/uploads/logo-regression.png';
        const update = await fetch(`${application.baseUrl}/audit-panel/api/content`, {
            method: 'PUT',
            headers: { origin: application.baseUrl, cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ images: { logo: logoUrl } })
        });
        assert.equal(update.status, 200);
        const page = await (await fetch(`${application.baseUrl}/proyecto/1`)).text();
        assert.match(page, new RegExp(`<img src="${logoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" alt="NAD Constructora"`));
        assert.equal(page.includes('<img src="/nad.png" alt="NAD Constructora">'), false);
    });

    await t.test('renderiza enlaces rastreables y datos estructurados de proyectos', async () => {
        const projects = await (await fetch(`${application.baseUrl}/api/projects`)).json();
        assert.ok(projects.length > 0);
        const project = projects[0];
        const projectPath = `/proyecto/${project.id}`;

        const homepage = await (await fetch(`${application.baseUrl}/`)).text();
        const listing = await (await fetch(`${application.baseUrl}/proyectos`)).text();
        assert.match(homepage, new RegExp(`href="${projectPath}"`));
        assert.match(listing, new RegExp(`href="${projectPath}"`));
        assert.match(listing, /"@type":"ItemList"/);

        const detail = await (await fetch(`${application.baseUrl}${projectPath}`)).text();
        assert.match(detail, /"@type":"CreativeWork"/);
        assert.match(detail, /"@type":"BreadcrumbList"/);
        assert.match(detail, /class="project-breadcrumbs container"/);
        assert.equal(detail.includes('{{STRUCTURED_DATA}}'), false);
        assert.equal(detail.includes('{{CSP_NONCE}}'), false);
    });

    await t.test('el sitemap incluye fechas reales de modificación', async () => {
        const response = await fetch(`${application.baseUrl}/sitemap.xml`);
        assert.equal(response.status, 200);
        const sitemap = await response.text();
        assert.match(sitemap, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
        assert.match(sitemap, /<loc>http:\/\/127\.0\.0\.1:\d+\/proyecto\/\d+<\/loc>/);
    });

    await t.test('redirige www al dominio canónico configurado', async () => {
        const canonical = new URL(application.baseUrl);
        const response = await fetch(`${application.baseUrl}/proyectos?vista=grid`, {
            redirect: 'manual',
            headers: { 'x-forwarded-host': `www.${canonical.host}` }
        });
        assert.equal(response.status, 301);
        assert.equal(response.headers.get('location'), `${application.baseUrl}/proyectos?vista=grid`);
    });

    await t.test('eliminar todos los proyectos es persistente después de reiniciar', async () => {
        const projects = await (await fetch(`${application.baseUrl}/audit-panel/api/projects`, {
            headers: { cookie }
        })).json();
        assert.ok(projects.length > 0);
        for (const project of projects) {
            const response = await fetch(`${application.baseUrl}/audit-panel/api/projects/${project.id}`, {
                method: 'DELETE',
                headers: { origin: application.baseUrl, cookie }
            });
            assert.equal(response.status, 200);
        }

        await stopApplication(application.child);
        application = await startApplication(dataDir, credentials);
        cookie = await login(application.baseUrl, credentials.password);
        const afterRestart = await (await fetch(`${application.baseUrl}/api/projects`)).json();
        assert.deepEqual(afterRestart, []);
    });
});
