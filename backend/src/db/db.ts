import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

// When Postgres restarts it kills idle connections and the pool emits 'error'. With no
// listener Node treats that as an unhandled error and the whole API process exits.
// Logging it is enough: the pool drops the dead client and opens a new one on next use.
pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

// Either the pool (one-off query) or a client inside a transaction.
export type Tx = pg.PoolClient;
export type Db = pg.Pool | Tx;

// Runs `work` inside BEGIN ... COMMIT. If it throws, everything is rolled back,
// so a failed order never leaves a half-made hold behind.
export async function withTransaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  // The pool's listener only covers idle clients. A checked-out client that loses its
  // connection between two queries emits 'error' on itself, which would also crash the
  // process. Note it here; the next query on this client fails and lands in `catch`.
  const onLostConnection = (err: Error) => {
    broken = true;
    console.error("PostgreSQL connection lost during a transaction", err);
  };
  client.on("error", onLostConnection);
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    // If the connection died, ROLLBACK fails too. Swallow that so the caller sees the
    // real error, and remember the client is broken (Postgres rolls back on disconnect anyway).
    await client.query("ROLLBACK").catch(() => {
      broken = true;
    });
    throw err;
  } finally {
    client.off("error", onLostConnection);
    client.release(broken); // true = destroy this client instead of reusing a dead socket
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
