'use strict';

const session = require('express-session');

class SQLiteSessionStore extends session.Store {
    constructor(db, options = {}) {
        super();
        this.db = db;
        this.defaultTtlMs = options.defaultTtlMs || 8 * 60 * 60 * 1000;
        this.cleanupIntervalMs = options.cleanupIntervalMs || 15 * 60 * 1000;

        this.db.run(`CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            sess TEXT NOT NULL,
            expire INTEGER NOT NULL
        )`);

        this.cleanupTimer = setInterval(() => this.cleanupExpired(), this.cleanupIntervalMs);
        if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    }

    _expiryFromSession(sess) {
        if (sess && sess.cookie && sess.cookie.expires) {
            const timestamp = new Date(sess.cookie.expires).getTime();
            if (Number.isFinite(timestamp)) return timestamp;
        }
        return Date.now() + this.defaultTtlMs;
    }

    get(sid, callback) {
        this.db.get('SELECT sess, expire FROM sessions WHERE sid = ?', [sid], (err, row) => {
            if (err) return callback(err);
            if (!row) return callback(null, null);

            if (row.expire <= Date.now()) {
                return this.destroy(sid, destroyErr => callback(destroyErr || null, null));
            }

            try {
                callback(null, JSON.parse(row.sess));
            } catch (parseErr) {
                this.destroy(sid, () => callback(parseErr));
            }
        });
    }

    set(sid, sess, callback = () => {}) {
        const expire = this._expiryFromSession(sess);
        let serialized;
        try {
            serialized = JSON.stringify(sess);
        } catch (err) {
            return callback(err);
        }

        this.db.run(
            `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
             ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
            [sid, serialized, expire],
            callback
        );
    }

    touch(sid, sess, callback = () => {}) {
        const expire = this._expiryFromSession(sess);
        this.db.run(
            'UPDATE sessions SET expire = ? WHERE sid = ?',
            [expire, sid],
            callback
        );
    }

    destroy(sid, callback = () => {}) {
        this.db.run('DELETE FROM sessions WHERE sid = ?', [sid], callback);
    }

    clear(callback = () => {}) {
        this.db.run('DELETE FROM sessions', callback);
    }

    cleanupExpired() {
        this.db.run('DELETE FROM sessions WHERE expire <= ?', [Date.now()], err => {
            if (err) console.warn('No se pudieron limpiar sesiones expiradas:', err.message);
        });
    }

    close() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
}

module.exports = SQLiteSessionStore;
