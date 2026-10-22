import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isPrivateAddress } from "../src/modules/images/fetchImage.js";
import { api, baseUrl, loginAs, resetDb, startApp, stopApp } from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);

let admin: Record<string, string>;
beforeEach(async () => {
  await resetDb();
  admin = (await loginAs("admin")).headers;
});

// A test picture: wide, grey, with a bright red square near the right edge (the "interesting" part).
async function widePhoto(width = 1200, height = 600, format: "png" | "jpeg" = "png") {
  const side = Math.min(200, Math.floor(height / 2)); // the red square must fit inside small test pictures
  const spot = await sharp({ create: { width: side, height: side, channels: 3, background: "#ff0000" } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: "#888888" } })
    .composite([{ input: spot, left: width - side - 60, top: Math.round((height - side) / 2) }])
    [format]()
    .toBuffer();
}

const upload = (body: Buffer, headers = admin, type = "image/png") =>
  fetch(`${baseUrl()}/admin/images`, { method: "POST", headers: { ...headers, "Content-Type": type }, body: new Uint8Array(body) });

describe("smart image upload", () => {
  it("crops any photo to a 512 x 512 WebP square, keeping the interesting part", async () => {
    const res = await upload(await widePhoto());
    expect(res.status).toBe(201);
    const result = await res.json();
    expect(result).toMatchObject({ original: { width: 1200, height: 600 }, cropped: true });
    expect(result.imageUrl).toMatch(/^\/api\/images\/[0-9a-f-]{36}$/);

    const image = await fetch(`${baseUrl()}${result.imageUrl.replace("/api", "")}`);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect(image.headers.get("cache-control")).toContain("immutable");
    const bytes = Buffer.from(await image.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);

    // The smart crop moved towards the red square: the right half of the result is mostly red.
    const { data } = await sharp(bytes).extract({ left: 300, top: 156, width: 200, height: 200 }).raw().toBuffer({ resolveWithObject: true });
    const redPixels = data.filter((_, i) => i % 3 === 0).filter((r, i) => r > 200 && data[i * 3 + 1] < 80).length;
    expect(redPixels).toBeGreaterThan(200 * 200 * 0.3);
  });

  it("square photos are resized but not cropped; JPEG works too", async () => {
    const result = await upload(await widePhoto(800, 800, "jpeg"), admin, "image/jpeg").then((r) => r.json());
    expect(result).toMatchObject({ original: { width: 800, height: 800 }, cropped: false });
  });

  it("refuses files that are not images, tiny images, and files over 8 MB", async () => {
    const notImage = await upload(Buffer.from("<html>hello</html>"));
    expect(notImage.status).toBe(400);
    expect((await notImage.json()).error).toBe("NOT_AN_IMAGE");

    const tiny = await upload(await widePhoto(300, 120));
    expect(tiny.status).toBe(400);
    expect((await tiny.json()).message).toContain("300×120");

    expect((await upload(Buffer.alloc(9 * 1024 * 1024, 1))).status).toBe(413);
  });

  it("only admins can upload", async () => {
    const staff = (await loginAs("staff")).headers;
    expect((await upload(await widePhoto(), staff)).status).toBe(403);
    expect((await upload(await widePhoto(), {})).status).toBe(401);
  });

  it("a product can use an uploaded image", async () => {
    const { imageUrl } = await upload(await widePhoto()).then((r) => r.json());
    const res = await api("/admin/products", {
      method: "POST",
      headers: admin,
      body: { name: "Nachos", pricePaise: 5000, stock: 5, category: "chips", imageUrl },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).imageUrl).toBe(imageUrl);
  });
});

describe("import from a link", () => {
  const importUrl = (url: string) => api("/admin/images/import", { method: "POST", headers: admin, body: { url } });

  it("refuses non-https links and links to local or private addresses", async () => {
    for (const url of [
      "http://example.com/a.png",
      "ftp://example.com/a.png",
      "not a link",
      "https://127.0.0.1/a.png",
      "https://localhost/a.png",
      "https://[::1]/a.png",
      "https://10.0.0.5/a.png",
      "https://192.168.1.10/a.png",
      "https://169.254.169.254/latest/meta-data", // cloud metadata service
    ]) {
      const res = await importUrl(url);
      expect(res.status, url).toBe(400);
    }
  });

  it("knows which addresses are private", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "142.250.183.14", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
