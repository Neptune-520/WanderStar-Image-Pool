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
}

export interface CategoryConfig {
  apis: ApiConfig[];
}

let db: Database;
const DB_FILE = path.join(process.cwd(), 'data.sqlite');
const OLD_DATA_FILE = path.join(process.cwd(), 'data.json');

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string): Promise<boolean> {
  const row = await db.get(`SELECT value FROM settings WHERE key = 'admin_password'`);
  if (!row) return false;
  
  const [salt, storedHash] = row.value.split(':');
  if (!salt || !storedHash) return false;
  
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === storedHash;
}

export async function updatePassword(newPassword: string) {
  const hashed = hashPassword(newPassword);
  await db.run(`INSERT INTO settings (key, value) VALUES ('admin_password', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [hashed, hashed]);
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.get(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row ? row.value : null;
}

export async function updateSetting(key: string, value: string) {
  await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [key, value, value]);
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

  const tableInfo = await db.all(`PRAGMA table_info(apis)`);
  const hasPriority = tableInfo.some(col => col.name === 'priority');
  if (!hasPriority) {
    await db.exec(`ALTER TABLE apis ADD COLUMN priority INTEGER DEFAULT 0`);
  }

  const passRow = await db.get(`SELECT value FROM settings WHERE key = 'admin_password'`);
  if (!passRow) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    await updatePassword(adminPassword);
  }

  const catCount = await db.get(`SELECT COUNT(*) as count FROM categories`);
  if (catCount.count === 0 && fs.existsSync(OLD_DATA_FILE)) {
    try {
      const content = fs.readFileSync(OLD_DATA_FILE, 'utf-8');
      const oldCategories = JSON.parse(content);
      
      for (const catName of Object.keys(oldCategories)) {
        await db.run(`INSERT INTO categories (name) VALUES (?)`, [catName]);
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
  const cats = await db.all(`SELECT name FROM categories`);
  const result: Record<string, CategoryConfig> = {};
  
  for (const cat of cats) {
    result[cat.name] = { apis: [] };
    const apis = await db.all(`SELECT * FROM apis WHERE category_name = ? ORDER BY priority ASC`, [cat.name]);
    result[cat.name].apis = apis.map(row => ({
      id: row.id,
      url: row.url,
      type: row.type as ApiType,
      jsonPath: row.jsonPath || undefined,
      isManuallyBanned: row.isManuallyBanned === 1,
      priority: row.priority
    }));
  }
  return result;
}

export async function addCategory(name: string): Promise<boolean> {
  try {
    await db.run(`INSERT INTO categories (name) VALUES (?)`, [name]);
    return true;
  } catch (err) {
    return false;
  }
}

export async function deleteCategory(name: string): Promise<boolean> {
  const res = await db.run(`DELETE FROM categories WHERE name = ?`, [name]);
  if (res.changes && res.changes > 0) {
    await db.run(`DELETE FROM apis WHERE category_name = ?`, [name]);
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
    return true;
  } catch (err) {
    return false;
  }
}

export async function deleteApi(categoryName: string, id: string): Promise<boolean> {
  const res = await db.run(`DELETE FROM apis WHERE category_name = ? AND id = ?`, [categoryName, id]);
  return (res.changes !== undefined && res.changes > 0);
}

export async function setApiBanState(categoryName: string, id: string, isBanned: boolean): Promise<boolean> {
  const res = await db.run(`UPDATE apis SET isManuallyBanned = ? WHERE category_name = ? AND id = ?`, 
    [isBanned ? 1 : 0, categoryName, id]);
  return (res.changes !== undefined && res.changes > 0);
}

export async function clearAllManualBans(): Promise<number> {
  const res = await db.run(`UPDATE apis SET isManuallyBanned = 0 WHERE isManuallyBanned = 1`);
  return res.changes || 0;
}

export async function reorderApis(categoryName: string, apiIds: string[]): Promise<boolean> {
  try {
    await db.run('BEGIN TRANSACTION');
    for (let i = 0; i < apiIds.length; i++) {
      await db.run(`UPDATE apis SET priority = ? WHERE category_name = ? AND id = ?`, [i, categoryName, apiIds[i]]);
    }
    await db.run('COMMIT');
    return true;
  } catch (err) {
    await db.run('ROLLBACK');
    return false;
  }
}
