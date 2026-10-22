import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

// Either the pool (one-off query) or a client inside a transaction.
export type Tx = pg.PoolClient;
export type Db = pg.Pool | Tx;

// Runs `work` inside BEGIN ... COMMIT. If it throws, everything is rolled back,
// so a failed order never leaves a half-made hold behind.
export async function withTransaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

// Five starter products. Only inserted when the table is empty.
export async function seed() {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM products");
  if (rows[0].n > 0) return;
  await pool.query(
    `INSERT INTO products (name, price_paise, stock) VALUES
       ('Masala Chips',   2000, 10),
       ('Chocolate Bar',  4500,  8),
       ('Cold Coffee',    6000,  6),
       ('Glucose Biscuits', 1000, 15),
       ('Roasted Peanuts', 3000, 12)`,
  );
}
