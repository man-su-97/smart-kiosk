import { useRef, useState } from "react";
import { ProductImage } from "../ProductImage";
import { importImage, uploadImage, type StoredImage } from "./adminApi";

const MAX_BYTES = 8 * 1024 * 1024;

// Smart upload: pick or drop a file from the computer, or paste an image link. The server checks
// it, smart-crops it to the standard 512 x 512 square and returns the address to save on the product.
export function ImagePicker({ name, value, onChange }: { name: string; value: string | null; onChange: (url: string | null) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState<StoredImage | null>(null);
  const [dragging, setDragging] = useState(false);

  async function run(work: () => Promise<StoredImage>) {
    setBusy(true);
    setError("");
    try {
      const stored = await work();
      setInfo(stored);
      onChange(stored.imageUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function useFile(file: File | undefined) {
    if (!file) return;
    // Quick checks in the browser; the server checks again by reading the file itself.
    if (!file.type.startsWith("image/")) return setError("Choose an image file (JPEG, PNG, WebP…)");
    if (file.size > MAX_BYTES) return setError("Image is larger than 8 MB");
    run(() => uploadImage(file));
  }

  return (
    <div className="flex flex-col gap-2 text-sm font-semibold">
      Product image
      <div
        data-testid="image-drop"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          useFile(e.dataTransfer.files[0]);
        }}
        className={`flex items-center gap-4 rounded-2xl border-2 border-dashed p-3 ${dragging ? "border-brand bg-[#fff1ea]" : "border-line"}`}
      >
        <div className="grid size-24 shrink-0 place-items-center rounded-xl bg-soft">
          {busy ? <span className="text-xs text-muted">Processing…</span> : <ProductImage name={name || "snack"} imageUrl={value} className="size-24" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 font-normal">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn px-3 py-2 text-sm" onClick={() => fileInput.current?.click()} disabled={busy}>
              Choose file…
            </button>
            <span className="text-xs text-muted">or drop a picture here</span>
            {value && (
              <button type="button" className="btn btn-ghost px-3 py-2 text-sm" onClick={() => { onChange(null); setInfo(null); }}>
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            aria-label="Image file"
            className="hidden"
            onChange={(e) => {
              useFile(e.target.files?.[0]);
              e.target.value = ""; // allow choosing the same file again
            }}
          />
          <div className="flex gap-2">
            <input
              aria-label="Image link"
              placeholder="https://… (link to the picture itself)"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border-2 border-line p-2 outline-none focus:border-brand"
            />
            <button type="button" className="btn px-3 py-2 text-sm" disabled={!link.trim() || busy} onClick={() => run(() => importImage(link.trim()))}>
              Import
            </button>
          </div>
          {info && (
            <span className="text-xs text-[#167a4a]" data-testid="image-info">
              ✓ {info.original.width}×{info.original.height} → standard 512×512
              {info.cropped ? " (smart-cropped to a square)" : ""}
            </span>
          )}
          {error && <span className="text-xs font-semibold text-bad">{error}</span>}
          <span className="text-xs text-muted">At least 200×200. Every image is cropped to the same square so the kiosk looks tidy.</span>
        </div>
      </div>
    </div>
  );
}
