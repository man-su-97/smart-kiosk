import { createHmac, timingSafeEqual } from "node:crypto";

// Hex HMAC-SHA256 of the raw request body.
export function sign(rawBody: Buffer | string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function isValidSignature(rawBody: Buffer, header: string | undefined, secret: string) {
  if (!header) return false;
  const expected = Buffer.from(sign(rawBody, secret));
  const received = Buffer.from(header);
  // timingSafeEqual needs equal lengths. It compares in constant time, so an
  // attacker cannot learn the signature byte by byte from response timing.
  return expected.length === received.length && timingSafeEqual(expected, received);
}
