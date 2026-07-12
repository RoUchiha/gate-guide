import test from "node:test";
import assert from "node:assert/strict";
import handler from "../index.js";

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk;
    }
  };
  return res;
}

async function request(path, method = "GET") {
  const res = mockResponse();
  await handler({ url: path, method }, res);
  return res;
}

test("serves the app shell at / with security headers", async () => {
  const res = await request("/");
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.match(res.headers["content-security-policy"], /default-src 'self'/);
  assert.match(String(res.body), /Gate Guide/);
});

test("serves static assets with correct MIME types", async () => {
  const css = await request("/styles.css");
  assert.equal(css.statusCode, 200);
  assert.match(css.headers["content-type"], /text\/css/);

  const manifest = await request("/manifest.webmanifest");
  assert.equal(manifest.statusCode, 200);
  assert.match(manifest.headers["content-type"], /manifest\+json/);

  const icon = await request("/icons/icon-192.png");
  assert.equal(icon.statusCode, 200);
  assert.equal(icon.headers["content-type"], "image/png");
});

test("returns 404 for missing asset paths instead of the app shell", async () => {
  const res = await request("/no-such-asset.png");
  assert.equal(res.statusCode, 404);
  assert.match(res.headers["content-type"], /text\/plain/);
});

test("falls back to the app shell for extensionless client routes", async () => {
  const res = await request("/some/client/route");
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(String(res.body), /Gate Guide/);
});

test("blocks encoded path traversal outside the public root", async () => {
  // URL parsing normalizes plain and %2e-encoded dot segments, but an
  // encoded backslash survives to the filesystem join. On Windows it is a
  // separator (guard responds 403); on POSIX it is a literal filename that
  // does not exist (404). Either way the file must never be served.
  const res = await request("/..%5Cpackage.json");
  assert.ok([403, 404].includes(res.statusCode), `expected 403 or 404, got ${res.statusCode}`);
  assert.doesNotMatch(String(res.body || ""), /"name":\s*"gate-guide"/);
});

test("rejects non-GET methods", async () => {
  const res = await request("/api/providers", "POST");
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "GET, HEAD");
});

test("reports provider status as JSON", async () => {
  const res = await request("/api/providers");
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.ok(payload.flight);
  assert.ok(payload.airportMap);
  assert.equal(typeof payload.productionMapsRequired, "boolean");
});

test("returns 404 JSON for unknown API endpoints", async () => {
  const res = await request("/api/nope");
  assert.equal(res.statusCode, 404);
  const payload = JSON.parse(res.body);
  assert.match(payload.error, /Unknown API endpoint/);
});

test("serves the airport map API with diagnostics", async () => {
  const res = await request("/api/airport-map?airport=DFW");
  const payload = JSON.parse(res.body);
  if (res.statusCode === 200) {
    assert.equal(payload.map.airportCode, "DFW");
    assert.equal(payload.diagnostics.valid, true);
  } else {
    // Environments with GATE_GUIDE_MAP_MODE=production and no provider
    // configured legitimately return 503 here.
    assert.equal(res.statusCode, 503);
    assert.equal(payload.productionRequired, true);
  }
});
