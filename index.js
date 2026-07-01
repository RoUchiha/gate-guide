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
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

export default async function handler(req, res) {
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

  const normalizedRequest = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = normalize(join(rootPath, normalizedRequest));

  if (!filePath.startsWith(rootPath)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.setHeader("Content-Type", types[extname(filePath)] || "application/octet-stream");
    res.setHeader("Cache-Control", extname(filePath) === ".html" ? "no-store" : "public, max-age=300");
    res.statusCode = 200;
    res.end(body);
  } catch {
    const body = await readFile(join(rootPath, "index.html"));
    res.setHeader("Content-Type", types[".html"]);
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 200;
    res.end(body);
  }
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
