import { pool, withTransaction } from "../../db/db.js";
import { HttpError } from "../../errors.js";
import { getHeldUnits, listProducts } from "../products/service.js";

export type ProductInput = {
  name: string;
  pricePaise: number;
  costPaise: number;
  stock: number;
  category: string;
  imageUrl: string | null;
  active: boolean;
};

export const listAllProducts = () => listProducts(pool, { includeInactive: true });

async function productById(id: number) {
  const all = await listAllProducts();
  const product = all.find((p) => p.id === id);
  if (!product) throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found");
  return product;
}

export async function createProduct(input: ProductInput) {
  const { rows } = await pool.query(
    `INSERT INTO products (name, price_paise, cost_paise, stock, category, image_url, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.name, input.pricePaise, input.costPaise, input.stock, input.category, input.imageUrl, input.active],
  );
  return productById(rows[0].id);
}

// Partial update. Locks the product row the same way createOrder does, so a stock change
// and an order for this product cannot interleave.
export async function updateProduct(id: number, changes: Partial<ProductInput>) {
  await withTransaction(async (tx) => {
    const { rows } = await tx.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [id]);
    if (rows.length === 0) throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found");
    const current = rows[0];

    const next: ProductInput = {
      name: changes.name ?? current.name,
      pricePaise: changes.pricePaise ?? current.price_paise,
      costPaise: changes.costPaise ?? current.cost_paise,
      stock: changes.stock ?? current.stock,
      category: changes.category ?? current.category,
      imageUrl: changes.imageUrl !== undefined ? changes.imageUrl : current.image_url,
      active: changes.active ?? current.active,
    };
    if (next.costPaise > next.pricePaise) {
      throw new HttpError(400, "COST_ABOVE_PRICE", "Cost cannot be higher than the price");
    }

    // Core rule: units already promised to customers (unpaid holds + paid, not collected)
    // must still exist after the change, or those orders could never be picked up.
    const held = (await getHeldUnits(tx, [id])).get(id) ?? 0;
    if (next.stock < held) {
      throw new HttpError(409, "STOCK_BELOW_HELD", `Stock cannot go below ${held}: units already held by orders`, {
        held,
      });
    }

    await tx.query(
      `UPDATE products
          SET name = $2, price_paise = $3, cost_paise = $4, stock = $5, category = $6, image_url = $7, active = $8
        WHERE id = $1`,
      [id, next.name, next.pricePaise, next.costPaise, next.stock, next.category, next.imageUrl, next.active],
    );
  });
  return productById(id);
}
