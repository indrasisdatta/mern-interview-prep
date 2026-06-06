const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

function sha256hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
}

class Store {
  constructor(dbPath = path.join(__dirname, "..", "data.db")) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS urls (
        short_code     TEXT PRIMARY KEY,
        long_url       TEXT NOT NULL,
        long_url_hash  TEXT NOT NULL,
        user_id        TEXT,
        created_at     INTEGER NOT NULL,
        expires_at     INTEGER,
        is_active      INTEGER NOT NULL DEFAULT 1,
        click_count    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS urls_long_hash_idx ON urls(long_url_hash, user_id);

      CREATE TABLE IF NOT EXISTS counters (
        name      TEXT PRIMARY KEY,
        value     INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO counters(name, value) VALUES ('url', 0);
    `);

    // Prepared statements for hot paths
    this.stmts = {
      findByCode:   this.db.prepare("SELECT * FROM urls WHERE short_code = ?"),
      findByHash:   this.db.prepare("SELECT * FROM urls WHERE long_url_hash = ? AND (user_id IS ? OR user_id = ?)"),
      insertOne:    this.db.prepare(`INSERT INTO urls (short_code, long_url, long_url_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`),
      incrementClicks: this.db.prepare("UPDATE urls SET click_count = click_count + ? WHERE short_code = ?"),
      getCounter:   this.db.prepare("SELECT value FROM counters WHERE name = ?"),
      setCounter:   this.db.prepare("UPDATE counters SET value = ? WHERE name = ?"),
    };

    this.allocateRangeTx = this.db.transaction((counterName, size) => {
      const row = this.stmts.getCounter.get(counterName);
      const start = row.value;
      this.stmts.setCounter.run(start + size, counterName);
      return { start, count: size };
    });
  }

  async allocateRange(size = 10_000) {
    return this.allocateRangeTx("url", size);
  }

  async findByCode(code) {
    const row = this.stmts.findByCode.get(code);
    if (!row) return null;
    row.is_active = !!row.is_active;
    return row;
  }

  async findByLongUrl(longUrl, userId = null) {
    const hash = sha256hex(longUrl);
    return this.stmts.findByHash.get(hash, userId, userId);
  }

  async insertOne({ shortCode, longUrl, userId = null, expiresAt = null }) {
    const hash = sha256hex(longUrl);
    try {
      this.stmts.insertOne.run(shortCode, longUrl, hash, userId, Date.now(), expiresAt);
      return { shortCode, longUrl, userId, createdAt: Date.now(), expiresAt };
    } catch (e) {
      if (e.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
        const err = new Error("Short code taken");
        err.code = "DUPLICATE_SHORT_CODE";
        throw err;
      }
      throw e;
    }
  }

  async incrementClicks(updates /* Map<shortCode, count> */) {
    const tx = this.db.transaction((entries) => {
      for (const [code, delta] of entries) {
        this.stmts.incrementClicks.run(delta, code);
      }
    });
    tx(Array.from(updates.entries()));
  }

  close() { this.db.close(); }
}

module.exports = { Store, sha256hex };
