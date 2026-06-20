const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'fm-radio.db');

let wrapperDb = null;
let rawSqlDb = null;

async function getDb() {
  if (!wrapperDb) {
    wrapperDb = await initialize();
  }
  return wrapperDb;
}

function saveDb() {
  if (!rawSqlDb) return;
  const data = rawSqlDb.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

async function initialize() {
  const SQL = await initSqlJs();

  let existingData = null;
  if (fs.existsSync(DB_PATH)) {
    existingData = fs.readFileSync(DB_PATH);
  }

  const sqlDb = existingData ? new SQL.Database(existingData) : new SQL.Database();

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT,
      location TEXT,
      avatar TEXT,
      role TEXT DEFAULT 'broadcaster',
      status TEXT DEFAULT 'active',
      is_live INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT DEFAULT 'Live Broadcast',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      listener_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'live',
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create admin user if not exists
  const adminCheck = sqlDb.exec("SELECT id FROM users WHERE role = 'admin'");
  if (!adminCheck.length || adminCheck[0].values.length === 0) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    sqlDb.run(
      "INSERT INTO users (username, email, password, display_name, role, location) VALUES (?, ?, ?, ?, ?, ?)",
      ['admin', 'admin@fmradio.com', hashedPassword, 'Admin', 'admin', 'Headquarters']
    );
    console.log('Admin user created: admin / admin123');
  }

  // Default settings
  const settingsCheck = sqlDb.exec("SELECT key FROM settings WHERE key = 'site_name'");
  if (!settingsCheck.length || settingsCheck[0].values.length === 0) {
    sqlDb.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('site_name', 'FM Radio Live')");
    sqlDb.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('site_description', 'Live Broadcasting Platform')");
    sqlDb.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_listeners', '1000')");
    sqlDb.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_registration', 'true')");
  }

  rawSqlDb = sqlDb;
  saveDb();
  console.log('Database initialized successfully');

  const wrapper = {

    run(sql, params = []) {
      sqlDb.run(sql, params);
      saveDb();
    },

    get(sql, params = []) {
      try {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const obj = {};
          cols.forEach((col, i) => { obj[col] = vals[i]; });
          return obj;
        }
        stmt.free();
        return null;
      } catch (e) {
        return null;
      }
    },

    all(sql, params = []) {
      try {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const obj = {};
          cols.forEach((col, i) => { obj[col] = vals[i]; });
          rows.push(obj);
        }
        stmt.free();
        return rows;
      } catch (e) {
        return [];
      }
    },

    lastInsertRowid() {
      try {
        const stmt = sqlDb.prepare("SELECT last_insert_rowid() as id");
        if (stmt.step()) {
          const val = stmt.get()[0];
          stmt.free();
          return val || 0;
        }
        stmt.free();
        return 0;
      } catch (e) {
        return 0;
      }
    },

    save() {
      saveDb();
    }
  };

  return wrapper;
}

module.exports = { getDb, saveDb };