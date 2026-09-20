'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function callback(error) {
            if (error) reject(error);
            else resolve(this);
        });
    });
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function sanitizeSnapshot(snapshotPath) {
    const snapshot = new sqlite3.Database(snapshotPath);
    try {
        await run(snapshot, 'PRAGMA busy_timeout=5000');
        await run(snapshot, 'DELETE FROM sessions');
        await run(snapshot, 'PRAGMA journal_mode=DELETE');
        await run(snapshot, 'VACUUM');
    } finally {
        await close(snapshot);
    }
}

async function createSqliteSnapshot(db, snapshotPath) {
    await run(db, 'VACUUM INTO ?', [snapshotPath]);
    await sanitizeSnapshot(snapshotPath);
    return snapshotPath;
}

async function prepareBackup({ db, uploadsDir, tempRoot = os.tmpdir() }) {
    const backupDir = await fs.promises.mkdtemp(path.join(tempRoot, 'nad-backup-'));
    const snapshotPath = path.join(backupDir, 'nad.db');
    const uploadsSnapshot = path.join(backupDir, 'uploads');
    try {
        await createSqliteSnapshot(db, snapshotPath);
        if (uploadsDir && fs.existsSync(uploadsDir)) {
            await fs.promises.cp(uploadsDir, uploadsSnapshot, {
                recursive: true,
                force: false,
                errorOnExist: false
            });
        }
        return {
            backupDir,
            snapshotPath,
            uploadsSnapshot,
            async cleanup() {
                await fs.promises.rm(backupDir, { recursive: true, force: true });
            }
        };
    } catch (error) {
        await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

module.exports = {
    createSqliteSnapshot,
    prepareBackup
};
