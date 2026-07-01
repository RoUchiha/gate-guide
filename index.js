import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  providerStatus,
  resolveAirportMapCatalog,
  resolveAirportMapFromProviders,
  resolveFlightFromProviders
} from "./server/providers.js";

const root = new URL("./public/", import.meta.url);
const rootPath = fileURLToPath(root);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

export default async function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("Method Not Allowed");
    return;
  }

  const url = new URL(req.url, "https://gate.guide");
  const requestPath = decodeURIComponent(url.pathname);

  if (requestPath === "/api/providers") {
    return json(res, 200, providerStatus());
  }

  if (requestPath === "/api/flight") {
    try {
      const itinerary = await resolveFlightFromProviders({
        airline: url.searchParams.get("airline"),
        flightNumber: url.searchParams.get("flightNumber"),
        date: url.searchParams.get("date")
      });
      return json(res, 200, itinerary);
    } catch (error) {
      return json(res, error.statusCode || 500, { error: error.message });
    }
  }

  if (requestPath === "/api/airport-map") {
    try {
      const result = await resolveAirportMapFromProviders(url.searchParams.get("airport"));
      return json(res, 200, result);
    } catch (error) {
      return json(res, error.statusCode || 500, errorPayload(error));
    }
  }

  if (requestPath === "/api/airport-map/catalog") {
    try {
      const catalog = await resolveAirportMapCatalog();
      return json(res, 200, catalog);
    } catch (error) {
      return json(res, error.statusCode || 500, errorPayload(error));
    }
  }

  if (requestPath.startsWith("/api/")) {
    return json(res, 404, { error: `Unknown API endpoint: ${requestPath}` });
  }

  const normalizedRequest = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = normalize(join(rootPath, normalizedRequest));

  if (!filePath.startsWith(rootPath)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    serveAsset(res, 200, filePath, body);
  } catch {
    // Missing asset paths (anything with a file extension) are a real 404;
    // extensionless paths fall back to the app shell for PWA navigation.
    if (extname(filePath)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return;
    }
    const body = await readFile(join(rootPath, "index.html"));
    serveAsset(res, 200, "index.html", body);
  }
}

function serveAsset(res, statusCode, filePath, body) {
  const extension = extname(filePath);
  res.setHeader("Content-Type", types[extension] || "application/octet-stream");
  if (extension === ".html") {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
  } else if (extension === ".png" || extension === ".svg" || extension === ".ico") {
    res.setHeader("Cache-Control", "public, max-age=86400");
  } else {
    res.setHeader("Cache-Control", "public, max-age=300");
  }
  res.statusCode = statusCode;
  res.end(body);
}

function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
}

function errorPayload(error) {
  return {
    error: error.message,
    productionRequired: Boolean(error.productionRequired),
    diagnostics: error.diagnostics || null
  };
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}
