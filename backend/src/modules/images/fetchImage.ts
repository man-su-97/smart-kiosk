import { lookup } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch } from "undici";
import { HttpError } from "../../errors.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

// Addresses that belong to "this machine" or private networks. Importing from them is refused,
// so the image import cannot be used to make our server read internal services (SSRF).
const privateRanges = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) privateRanges.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  privateRanges.addSubnet(net, prefix, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address); // IPv4 written as IPv6
  if (mapped) return isPrivateAddress(mapped[1]);
  const family = isIP(address);
  if (family === 0) return true; // not an IP at all: refuse
  return privateRanges.check(address, family === 4 ? "ipv4" : "ipv6");
}

// DNS lookup used for the actual connection. Checking the name once and then letting fetch look
// it up again would leave a gap (DNS rebinding: "public" the first time, 127.0.0.1 the second).
// Here the check and the connection use the same answer.
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as { address: string; family: number }[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error(`Blocked private address for ${hostname}`), { code: "EBLOCKED" }), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

const publicOnlyAgent = new Agent({ connect: { lookup: publicOnlyLookup } });

// Download an image from a public https link, with limits on where, how long and how big.
export async function fetchImage(rawUrl: string): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, "BAD_URL", "That is not a valid link");
  }
  if (url.protocol !== "https:") throw new HttpError(400, "BAD_URL", "Only https:// links can be imported");

  // Links written as an IP address never reach the DNS lookup above, so check them here.
  // (Named hosts are also checked here first, only to give a clear message early.)
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) ? isPrivateAddress(host) : host === "localhost" || host.endsWith(".localhost")) {
    throw new HttpError(400, "BAD_URL", "Links to private or local addresses are not allowed");
  }

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, {
      dispatcher: publicOnlyAgent,
      redirect: "error", // a redirect could point somewhere we did not check
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "image/*", "User-Agent": "SnackKioskImageImport/1.0" },
    });
  } catch (err) {
    const blocked = String((err as { cause?: { code?: string } }).cause?.code) === "EBLOCKED";
    throw new HttpError(
      400,
      blocked ? "BAD_URL" : "DOWNLOAD_FAILED",
      blocked ? "Links to private or local addresses are not allowed" : "Could not download that link (it may redirect or be too slow)",
    );
  }
  if (!res.ok) throw new HttpError(400, "DOWNLOAD_FAILED", `Could not download that link (HTTP ${res.status})`);

  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) {
    throw new HttpError(
      400,
      "NOT_AN_IMAGE",
      "That link is a web page, not an image. Open the picture itself and copy its address (right-click → Copy image address).",
    );
  }

  // Read at most MAX_IMAGE_BYTES, whatever the server claims the size is.
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new HttpError(413, "TOO_LARGE", "Image is larger than 8 MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
