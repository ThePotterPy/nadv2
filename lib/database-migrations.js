'use strict';

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function callback(error) {
            if (error) reject(error);
            else resolve(this);
        });
    });
}

async function ensureColumn(db, table, column, definition) {
    const columns = await dbAll(db, `PRAGMA table_info(${table})`);
    if (!columns.some(item => item.name === column)) {
        await dbRun(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

async function recordMigration(db, version, name) {
    await dbRun(
        db,
        'INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)',
        [version, name]
    );
}

async function seedInitialProjects(db, projects) {
    await dbRun(db, 'BEGIN IMMEDIATE');
    try {
        for (const project of projects) {
            await dbRun(
                db,
                `INSERT INTO projects
                 (title, category, description, location, year, image, featured, visible, extra_media, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1, '[]', 'Terminado')`,
                [
                    project.title,
                    project.category,
                    project.description,
                    project.location,
                    project.year,
                    project.image,
                    project.featured !== undefined ? project.featured : 1
                ]
            );
        }
        await dbRun(db, 'COMMIT');
    } catch (error) {
        await dbRun(db, 'ROLLBACK').catch(() => {});
        throw error;
    }
}

async function initializeDatabase(db, options) {
    const {
        databaseWasPresent,
        initialProjects,
        defaultContent,
        getInitialAdminPassword,
        bcrypt
    } = options;

    await dbRun(db, 'PRAGMA journal_mode=WAL');
    await dbRun(db, 'PRAGMA busy_timeout=5000');
    await dbRun(db, 'PRAGMA foreign_keys=ON');

    await dbRun(db, `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await dbRun(db, `CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    await dbRun(db, `CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`);
    await dbRun(db, `CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        location TEXT NOT NULL,
        year INTEGER NOT NULL,
        image TEXT NOT NULL,
        featured INTEGER NOT NULL DEFAULT 1 CHECK (featured IN (0, 1)),
        visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
        extra_media TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'Terminado',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await dbRun(db, `CREATE TABLE IF NOT EXISTS site_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
    )`);
    await dbRun(db, `CREATE TABLE IF NOT EXISTS login_attempts (
        ip TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await dbRun(db, `CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
    )`);
    await recordMigration(db, 1, 'create_core_schema');

    await ensureColumn(db, 'projects', 'featured', 'INTEGER DEFAULT 1');
    await ensureColumn(db, 'projects', 'visible', 'INTEGER DEFAULT 1');
    await ensureColumn(db, 'projects', 'extra_media', "TEXT DEFAULT '[]'");
    await ensureColumn(db, 'projects', 'status', "TEXT DEFAULT 'Terminado'");
    await ensureColumn(db, 'projects', 'created_at', 'TEXT');
    await ensureColumn(db, 'projects', 'updated_at', 'TEXT');
    await ensureColumn(db, 'login_attempts', 'updated_at', 'TEXT');
    await recordMigration(db, 2, 'add_project_and_login_columns');

    await dbRun(db, "UPDATE projects SET extra_media = '[]' WHERE extra_media IS NULL");
    await dbRun(db, "UPDATE projects SET status = 'Terminado' WHERE status IS NULL OR trim(status) = ''");
    await dbRun(db, 'UPDATE projects SET featured = 1 WHERE featured IS NULL');
    await dbRun(db, 'UPDATE projects SET visible = 1 WHERE visible IS NULL');
    await dbRun(db, "UPDATE projects SET created_at = datetime('now') WHERE created_at IS NULL");
    await dbRun(db, 'UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL');
    await dbRun(db, "UPDATE projects SET category = REPLACE(REPLACE(category, '&oacute;', 'ó'), '&ntilde;', 'ñ')");
    await dbRun(db, "UPDATE projects SET title = REPLACE(REPLACE(title, '&oacute;', 'ó'), '&ntilde;', 'ñ')");
    await dbRun(db, "UPDATE projects SET description = REPLACE(REPLACE(description, '&oacute;', 'ó'), '&ntilde;', 'ñ')");
    await dbRun(db, "UPDATE login_attempts SET updated_at = datetime('now') WHERE updated_at IS NULL");
    await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_projects_public_order ON projects (visible, featured DESC, year DESC, id DESC)');
    await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_login_attempts_updated ON login_attempts (updated_at)');
    await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire)');
    await recordMigration(db, 3, 'normalize_data_and_add_indexes');

    const admin = await dbGet(db, 'SELECT id FROM admin ORDER BY id LIMIT 1');
    if (!admin) {
        const initialPassword = getInitialAdminPassword();
        if (!initialPassword) {
            console.warn('⚠️ ADMIN_DEFAULT_PASS no configurado: no se creará un administrador inicial.');
        } else {
            const passwordHash = await bcrypt.hash(initialPassword, 12);
            await dbRun(db, "INSERT INTO admin (username, password) VALUES ('admin', ?)", [passwordHash]);
            console.log('✅ Administrador inicial creado');
        }
    }

    const settings = await dbGet(db, 'SELECT id FROM site_settings WHERE id = 1');
    if (!settings) {
        await dbRun(db, 'INSERT INTO site_settings (id, data) VALUES (1, ?)', [JSON.stringify(defaultContent)]);
        console.log('📝 Contenido inicial del sitio cargado');
    }

    const seedMarker = await dbGet(db, "SELECT value FROM app_meta WHERE key = 'initial_projects_seeded'");
    if (!seedMarker) {
        if (!databaseWasPresent) {
            const count = await dbGet(db, 'SELECT COUNT(*) AS count FROM projects');
            if (count.count === 0) {
                await seedInitialProjects(db, initialProjects);
                console.log(`📦 ${initialProjects.length} proyectos iniciales cargados`);
            }
        }
        await dbRun(
            db,
            `INSERT INTO app_meta (key, value, updated_at) VALUES ('initial_projects_seeded', '1', datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        );
    }
    await recordMigration(db, 4, 'mark_initial_seed_as_complete');
    await recordMigration(db, 5, 'add_project_updated_at_for_sitemap');
}

module.exports = {
    initializeDatabase,
    dbGet,
    dbAll,
    dbRun
};
