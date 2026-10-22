import { useEffect, useState } from "react";
import { formatRupees } from "../api";
import { ProductImage } from "../ProductImage";
import { ImagePicker } from "./ImagePicker";
import { createProduct, fetchAdminProducts, updateProduct, type AdminProduct } from "./adminApi";
import { paiseToRupeesText, rupeesToPaise } from "./format";
import { productSchema } from "./productSchema";

// What the form holds while typing (text), before it becomes a product (numbers, paise).
type Draft = { name: string; price: string; cost: string; stock: string; category: string; imageUrl: string; active: boolean };
const EMPTY: Draft = { name: "", price: "", cost: "0", stock: "0", category: "", imageUrl: "", active: true };

const toDraft = (p: AdminProduct): Draft => ({
  name: p.name,
  price: paiseToRupeesText(p.pricePaise),
  cost: paiseToRupeesText(p.costPaise),
  stock: String(p.stock),
  category: p.category,
  imageUrl: p.imageUrl ?? "",
  active: p.active,
});

export function Products() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const [error, setError] = useState("");

  const load = () => fetchAdminProducts().then(setProducts).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function toggle(p: AdminProduct) {
    setError("");
    await updateProduct(p.id, { active: !p.active }).catch((e) => setError(e.message));
    load();
  }

  const categories = [...new Set(products.map((p) => p.category))];

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">Products</h1>
        <button className="btn btn-primary px-5 py-3 text-base" onClick={() => setEditing("new")}>+ Add product</button>
      </div>
      {error && <p className="mb-3 font-bold text-bad">{error}</p>}

      {editing && (
        <ProductEditor
          product={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              {["", "Name", "Category", "Price", "Cost", "Stock", "Available", "Status", ""].map((h, i) => (
                <th key={i} className="px-3 py-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} data-testid="product-row" className={`border-t border-line ${p.active ? "" : "opacity-50"}`}>
                <td className="px-3 py-2"><ProductImage name={p.name} imageUrl={p.imageUrl} /></td>
                <td className="px-3 py-2 font-semibold">{p.name}</td>
                <td className="px-3 py-2 capitalize">{p.category}</td>
                <td className="px-3 py-2">{formatRupees(p.pricePaise)}</td>
                <td className="px-3 py-2">{formatRupees(p.costPaise)}</td>
                <td className="px-3 py-2">{p.stock}</td>
                <td className="px-3 py-2">{p.available}</td>
                <td className="px-3 py-2">{p.active ? "On sale" : "Hidden"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button className="btn px-3 py-1.5 text-sm" onClick={() => setEditing(p)}>Edit</button>{" "}
                  <button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={() => toggle(p)}>{p.active ? "Hide" : "Show"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProductEditor({ product, categories, onClose, onSaved }: {
  product: AdminProduct | null; categories: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(product ? toDraft(product) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const set = (field: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [field]: field === "active" ? e.target.checked : e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");
    // Text -> numbers (paise), then the same rules as the server.
    const parsed = productSchema.safeParse({
      name: draft.name,
      pricePaise: rupeesToPaise(draft.price) ?? -1,
      costPaise: rupeesToPaise(draft.cost) ?? -1,
      stock: /^\d+$/.test(draft.stock) ? Number(draft.stock) : -1,
      category: draft.category,
      imageUrl: draft.imageUrl.trim() === "" ? null : draft.imageUrl,
      active: draft.active,
    });
    if (!parsed.success) {
      // First problem per field (e.g. "Category is required" rather than the pattern rule).
      const firstErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) firstErrors[String(issue.path[0])] ??= issue.message;
      setErrors(firstErrors);
      return;
    }
    setErrors({});
    try {
      if (product) await updateProduct(product.id, parsed.data);
      else await createProduct(parsed.data);
      onSaved();
    } catch (err) {
      setServerError((err as Error).message); // e.g. "Stock cannot go below 3: units already held by orders"
    }
  }

  const input = "w-full rounded-xl border-2 border-line p-2.5 outline-none focus:border-brand";
  const field = (key: keyof Draft, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, errorKey: string = key) => (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {label}
      <input value={String(draft[key])} onChange={set(key)} className={input} {...props} />
      {errors[errorKey] && <span className="font-normal text-bad">{errors[errorKey]}</span>}
    </label>
  );

  return (
    <form onSubmit={save} className="card mb-5 animate-pop" aria-label={product ? "Edit product" : "New product"}>
      <h2 className="mb-3 text-xl font-extrabold">{product ? `Edit ${product.name}` : "New product"}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {field("name", "Name")}
        {field("category", "Category", { list: "categories" })}
        {field("price", "Price (₹)", { inputMode: "decimal" }, "pricePaise")}
        {field("cost", "Cost (₹)", { inputMode: "decimal" }, "costPaise")}
        {field("stock", "Stock (units)", { inputMode: "numeric" })}
        <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold">
          <input type="checkbox" checked={draft.active} onChange={set("active")} className="size-5" /> On sale
        </label>
        <div className="md:col-span-2">
          <ImagePicker name={draft.name} value={draft.imageUrl || null} onChange={(url) => setDraft({ ...draft, imageUrl: url ?? "" })} />
          {errors.imageUrl && <span className="text-sm text-bad">{errors.imageUrl}</span>}
        </div>
      </div>
      <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      {serverError && <p className="mt-3 font-bold text-bad">{serverError}</p>}
      <div className="mt-4 flex gap-2.5">
        <button className="btn btn-primary px-6 py-3 text-base" type="submit">Save</button>
        <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
