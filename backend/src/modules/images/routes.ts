import express, { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../auth.js";
import { HttpError } from "../../errors.js";
import { fetchImage, MAX_IMAGE_BYTES } from "./fetchImage.js";
import { getImage, standardizeAndStore } from "./service.js";

export const imagesRouter = Router();

// Upload from the computer: the browser sends the file's bytes as the request body.
imagesRouter.post(
  "/admin/images",
  requireRole("admin"),
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, "NO_FILE", "No file received");
    res.status(201).json(await standardizeAndStore(req.body));
  },
);

// Import from a link: the server downloads it (safely), then treats it like an upload.
// This router is mounted before the app-wide JSON parser (uploads need raw bytes), so parse JSON here.
imagesRouter.post("/admin/images/import", requireRole("admin"), express.json(), async (req, res) => {
  const { url } = z.object({ url: z.string().trim().min(1).max(2000) }).parse(req.body);
  res.status(201).json(await standardizeAndStore(await fetchImage(url)));
});

// Public: the kiosk shows these. An image never changes (a new upload gets a new id),
// so browsers may cache it for a year.
imagesRouter.get("/images/:id", async (req, res) => {
  const image = await getImage(z.string().uuid().parse(req.params.id));
  res.setHeader("Content-Type", image.content_type);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(image.data);
});
