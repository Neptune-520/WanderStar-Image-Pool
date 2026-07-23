import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type ApiType = 'direct' | 'json';

export interface ApiConfig {
  id: string;
  url: string;
  type: ApiType;
  jsonPath?: string;
  isManuallyBanned?: boolean;
  priority?: number;
}

export interface CategoryConfig {
  name: string;
  displayName: string;
  description: string;
  apis: ApiConfig[];
}

let db: Database;
const DB_FILE = path.join(process.cwd(), 'data.sqlite');
const OLD_DATA_FILE = path.join(process.cwd(), 'data.json');

// Memory Cache
let cachedCategories: Record<string, CategoryConfig> | null = null;
let cachedSettings: Record<string, string> | null = null;

export function clearCache() {
  cachedCategories = null;
  cachedSettings = null;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyLogin(username: string, password: string): Promise<boolean> {
  const storedUser = await getSetting('admin_username');
  if (storedUser !== username) return false;
  
  const passRow = await db.get(`SELECT value FROM settings WHERE key = 'admin_password'`);
  if (!passRow) return false;
  
  const [salt, storedHash] = passRow.value.split(':');
  if (!salt || !storedHash) return false;
  
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === storedHash;
}

export async function updatePassword(newPassword: string) {
  const hashed = hashPassword(newPassword);
  await db.run(`INSERT INTO settings (key, value) VALUES ('admin_password', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [hashed, hashed]);
}

export async function getSetting(key: string): Promise<string | null> {
  if (!cachedSettings) {
    const rows = await db.all(`SELECT key, value FROM settings`);
    cachedSettings = {};
    for (const row of rows) {
      cachedSettings[row.key] = row.value;
    }
  }
  return cachedSettings[key] || null;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  if (!cachedSettings) await getSetting('');
  return cachedSettings || {};
}

export async function updateSetting(key: string, value: string) {
  await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [key, value, value]);
  clearCache();
}

export async function updateSettingsBatch(settings: Record<string, string>) {
  await db.run('BEGIN TRANSACTION');
  try {
    for (const [k, v] of Object.entries(settings)) {
      await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [k, v, v]);
    }
    await db.run('COMMIT');
    clearCache();
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

export async function initDB() {
  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS apis (
      id TEXT,
      category_name TEXT,
      url TEXT,
      type TEXT,
      jsonPath TEXT,
      isManuallyBanned INTEGER DEFAULT 0,
      PRIMARY KEY (category_name, id),
      FOREIGN KEY (category_name) REFERENCES categories(name) ON DELETE CASCADE
    );
  `);

  const catTableInfo = await db.all(`PRAGMA table_info(categories)`);
  if (!catTableInfo.some(col => col.name === 'displayName')) {
    await db.exec(`ALTER TABLE categories ADD COLUMN displayName TEXT`);
    await db.exec(`UPDATE categories SET displayName = name`);
  }
  if (!catTableInfo.some(col => col.name === 'description')) {
    await db.exec(`ALTER TABLE categories ADD COLUMN description TEXT`);
  }

  const tableInfo = await db.all(`PRAGMA table_info(apis)`);
  if (!tableInfo.some(col => col.name === 'priority')) {
    await db.exec(`ALTER TABLE apis ADD COLUMN priority INTEGER DEFAULT 0`);
  }

  const passRow = await db.get(`SELECT value FROM settings WHERE key = 'admin_password'`);
  if (!passRow) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    await updatePassword(adminPassword);
  }

  const userRow = await db.get(`SELECT value FROM settings WHERE key = 'admin_username'`);
  if (!userRow) {
    await updateSetting('admin_username', 'admin');
  }

  const retryRow = await db.get(`SELECT value FROM settings WHERE key = 'api_retry_count'`);
  if (!retryRow) {
    await updateSetting('api_retry_count', '2');
    await updateSetting('api_timeout_ms', '1500');
  }

  const catCount = await db.get(`SELECT COUNT(*) as count FROM categories`);
  if (catCount.count === 0 && fs.existsSync(OLD_DATA_FILE)) {
    try {
      const content = fs.readFileSync(OLD_DATA_FILE, 'utf-8');
      const oldCategories = JSON.parse(content);
      
      for (const catName of Object.keys(oldCategories)) {
        await db.run(`INSERT INTO categories (name, displayName, description) VALUES (?, ?, ?)`, [catName, catName, '']);
        let prio = 0;
        for (const api of oldCategories[catName].apis) {
          await db.run(`
            INSERT INTO apis (id, category_name, url, type, jsonPath, isManuallyBanned, priority) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [
            api.id, catName, api.url, api.type, api.jsonPath || null, api.isManuallyBanned ? 1 : 0, prio++
          ]);
        }
      }
    } catch (err) {}
  }
}

export async function getCategories(): Promise<Record<string, CategoryConfig>> {
  if (cachedCategories) return cachedCategories;

  const cats = await db.all(`SELECT name, displayName, description FROM categories`);
  const result: Record<string, CategoryConfig> = {};
  
  for (const cat of cats) {
    result[cat.name] = { 
      name: cat.name,
      displayName: cat.displayName || cat.name,
      description: cat.description || '',
      apis: [] 
    };
  }
  
  const apis = await db.all(`SELECT * FROM apis ORDER BY category_name, priority ASC`);
  for (const row of apis) {
    if (result[row.category_name]) {
      result[row.category_name].apis.push({
        id: row.id,
        url: row.url,
        type: row.type as ApiType,
        jsonPath: row.jsonPath || undefined,
        isManuallyBanned: row.isManuallyBanned === 1,
        priority: row.priority
      });
    }
  }
  
  cachedCategories = result;
  return result;
}

export async function addCategory(name: string, displayName: string, description: string): Promise<boolean> {
  try {
    await db.run(`INSERT INTO categories (name, displayName, description) VALUES (?, ?, ?)`, [name, displayName, description]);
    clearCache();
    return true;
  } catch (err) {
    return false;
  }
}

export async function editCategory(name: string, displayName: string, description: string): Promise<boolean> {
  const res = await db.run(`UPDATE categories SET displayName = ?, description = ? WHERE name = ?`, [displayName, description, name]);
  clearCache();
  return (res.changes !== undefined && res.changes > 0);
}

export async function deleteCategory(name: string): Promise<boolean> {
  const res = await db.run(`DELETE FROM categories WHERE name = ?`, [name]);
  if (res.changes && res.changes > 0) {
    await db.run(`DELETE FROM apis WHERE category_name = ?`, [name]);
    clearCache();
    return true;
  }
  return false;
}

export async function addApi(categoryName: string, api: ApiConfig): Promise<boolean> {
  try {
    await db.run(`
      INSERT INTO apis (id, category_name, url, type, jsonPath, isManuallyBanned) 
      VALUES (?, ?, ?, ?, ?, ?)
    `, [api.id, categoryName, api.url, api.type, api.jsonPath || null, api.isManuallyBanned ? 1 : 0]);
    clearCache();
    return true;
  } catch (err) {
    return false;
  }
}

export async function editApi(categoryName: string, oldId: string, api: ApiConfig): Promise<boolean> {
  try {
    await db.run(`
      UPDATE apis 
      SET id = ?, url = ?, type = ?, jsonPath = ?, isManuallyBanned = ?
      WHERE category_name = ? AND id = ?
    `, [api.id, api.url, api.type, api.jsonPath || null, api.isManuallyBanned ? 1 : 0, categoryName, oldId]);
    clearCache();
    return true;
  } catch (err) {
    return false;
  }
}

export async function deleteApi(categoryName: string, id: string): Promise<boolean> {
  const res = await db.run(`DELETE FROM apis WHERE category_name = ? AND id = ?`, [categoryName, id]);
  if (res.changes !== undefined && res.changes > 0) {
    clearCache();
    return true;
  }
  return false;
}

export async function setApiBanState(categoryName: string, id: string, isBanned: boolean): Promise<boolean> {
  const res = await db.run(`UPDATE apis SET isManuallyBanned = ? WHERE category_name = ? AND id = ?`, 
    [isBanned ? 1 : 0, categoryName, id]);
  if (res.changes !== undefined && res.changes > 0) {
    clearCache();
    return true;
  }
  return false;
}

export async function clearAllManualBans(categoryName?: string): Promise<number> {
  let res;
  if (categoryName) {
    res = await db.run(`UPDATE apis SET isManuallyBanned = 0 WHERE isManuallyBanned = 1 AND category_name = ?`, [categoryName]);
  } else {
    res = await db.run(`UPDATE apis SET isManuallyBanned = 0 WHERE isManuallyBanned = 1`);
  }
  clearCache();
  return res.changes || 0;
}

export async function reorderApis(categoryName: string, apiIds: string[]): Promise<boolean> {
  try {
    await db.run('BEGIN TRANSACTION');
    for (let i = 0; i < apiIds.length; i++) {
      await db.run(`UPDATE apis SET priority = ? WHERE category_name = ? AND id = ?`, [i, categoryName, apiIds[i]]);
    }
    await db.run('COMMIT');
    clearCache();
    return true;
  } catch (err) {
    await db.run('ROLLBACK');
    return false;
  }
}
