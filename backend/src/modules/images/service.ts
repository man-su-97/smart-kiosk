import sharp, { type Metadata } from "sharp";
import { pool } from "../../db/db.js";
import { HttpError } from "../../errors.js";

// Every product photo becomes the same: a 512 x 512 square WebP.
export const STANDARD_SIZE = 512;
// Smaller originals would look blurry once enlarged to the standard size.
export const MIN_SIDE = 200;
const FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif"]);

export type StoredImage = {
  imageUrl: string; // what to save on the product
  original: { width: number; height: number };
  cropped: boolean; // true when the original was not square, so a part was cut off
};

// Check the file really is an image (by reading it, not by trusting its name or type),
// then smart-crop it to the standard square and store it.
export async function standardizeAndStore(input: Buffer): Promise<StoredImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new HttpError(400, "NOT_AN_IMAGE", "That file is not an image we can read");
  }
  if (!meta.format || !FORMATS.has(meta.format)) {
    throw new HttpError(400, "UNSUPPORTED_IMAGE", "Use a JPEG, PNG, WebP, GIF or AVIF image");
  }

  // Phone photos are often stored sideways with a "rotate me" flag; use the size as displayed.
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const height = meta.autoOrient?.height ?? meta.height ?? 0;
  if (Math.min(width, height) < MIN_SIDE) {
    throw new HttpError(400, "IMAGE_TOO_SMALL", `Image is ${width}×${height}; it must be at least ${MIN_SIDE}×${MIN_SIDE}`);
  }

  // fit "cover" fills the square and cuts off what does not fit; position "attention" keeps the
  // most interesting part (busy, colourful areas) instead of always the middle: the smart crop.
  const data = await sharp(input, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize(STANDARD_SIZE, STANDARD_SIZE, { fit: "cover", position: sharp.strategy.attention })
    .webp({ quality: 82 })
    .toBuffer();

  const { rows } = await pool.query(
    `INSERT INTO images (data, content_type, original_width, original_height)
     VALUES ($1, 'image/webp', $2, $3) RETURNING id`,
    [data, width, height],
  );
  return { imageUrl: `/api/images/${rows[0].id}`, original: { width, height }, cropped: width !== height };
}

export async function getImage(id: string) {
  const { rows } = await pool.query("SELECT data, content_type FROM images WHERE id = $1", [id]);
  if (rows.length === 0) throw new HttpError(404, "IMAGE_NOT_FOUND", "Image not found");
  return rows[0] as { data: Buffer; content_type: string };
}
