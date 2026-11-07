import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const appUrl = process.argv[2];
if (!appUrl) {
  console.error("Usage: node scripts/smoke.mjs <app_url>");
  process.exit(2);
}

const base = new URL(appUrl);
const request = (path, options) => fetch(new URL(path, base), options);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pWQAAAAASUVORK5CYII=",
  "base64",
);

const upload = async (name, type, bytes) => {
  const form = new FormData();
  form.append("image", new Blob([bytes], { type }), name);
  return request("images", { method: "POST", body: form, redirect: "manual" });
};

const galleryKeys = async () => {
  const keys = new Set();
  const visited = new Set();
  let pageUrl = new URL("./", base);

  while (pageUrl && !visited.has(pageUrl.href)) {
    visited.add(pageUrl.href);
    const response = await fetch(pageUrl);
    assert.equal(response.status, 200, `gallery returned ${response.status} at ${pageUrl}`);
    const html = await response.text();
    for (const key of html.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png\b/gi) ?? []) keys.add(key);

    const pagination = html.match(/<nav\b[^>]*class="pagination"[^>]*>([\s\S]*?)<\/nav>/i)?.[1];
    const href = pagination?.match(/<a\b[^>]*href="([^"]+)"/i)?.[1]?.replaceAll("&amp;", "&");
    pageUrl = href ? new URL(href, pageUrl) : null;
  }

  return keys;
};

const existingKeys = await galleryKeys();

const success = await upload("smoke.png", "image/png", png);
assert.equal(success.status, 303, `valid image upload returned ${success.status}: ${await success.text()}`);

const afterUploadKeys = await galleryKeys();
const key = [...afterUploadKeys].find((candidate) => !existingKeys.has(candidate));
assert.ok(key, "gallery does not contain the newly uploaded PNG key");

const download = await request(`images/${encodeURIComponent(key)}`);
assert.equal(download.status, 200, `download returned ${download.status}`);
assert.deepEqual(Buffer.from(await download.arrayBuffer()), png, "downloaded PNG bytes differ");

const invalid = await upload("invalid.txt", "text/plain", Buffer.from("not an image"));
assert.equal(invalid.status, 400, `invalid image returned ${invalid.status}`);

const oversized = await upload("oversized.png", "image/png", Buffer.alloc(4 * 1024 * 1024 + 1));
assert.equal(oversized.status, 413, `oversized image returned ${oversized.status}`);

const missing = await request(`images/${randomUUID()}.png`);
assert.equal(missing.status, 404, `missing image returned ${missing.status}`);

console.log(`Smoke passed; uploaded and retained images/${key}`);
