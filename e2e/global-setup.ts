import pg from "pg";

// The tests buy and pick up real stock in the running app's database, so every run
// starts from the seed data. (This wipes the demo orders of the dev database.)
export default async function globalSetup() {
  const db = new pg.Client({ connectionString: "postgres://postgres:postgres@localhost:5432/pickup" });
  await db.connect();
  await db.query("TRUNCATE payment_events, order_items, orders");
  // Products added by the admin tests are removed; the five starter products are put back on sale.
  await db.query(
    "DELETE FROM products WHERE name NOT IN ('Masala Chips', 'Chocolate Bar', 'Cold Coffee', 'Glucose Biscuits', 'Roasted Peanuts')",
  );
  await db.query("UPDATE products SET active = true");
  await db.query(`UPDATE products SET stock = v.stock
                    FROM (VALUES ('Masala Chips', 10), ('Chocolate Bar', 8), ('Cold Coffee', 6),
                                 ('Glucose Biscuits', 15), ('Roasted Peanuts', 12)) AS v(name, stock)
                   WHERE products.name = v.name`);
  await db.end();
}
