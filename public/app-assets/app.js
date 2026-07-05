import { demoAirportMap, wifiProfileFor } from "./sample-data.js";
import { ApiFlightProvider, summarizeConnectionRisk } from "./flight-provider.js";
import { confidenceForReading, browserGpsReading, manualReading, projectOutdoorGpsToTerminal } from "./positioning.js";
import { connectToWifi, wifiCapability } from "./wifi-assistant.js";
import { formatDistance, getNode, isEdgeClosed, nearestNode, placeToNode, routeBetween } from "./router.js";

const state = {
  map: demoAirportMap,
  provider: new ApiFlightProvider(),
  providerStatus: null,
  mapDiagnostics: null,
  mapError: null,
  productionMapBlocked: false,
  itinerary: null,
  fromNodeId: "security-a",
  destinationNodeId: "gate-a18",
  positionConfidence: "manual",
  accessible: false,
  view: null,
  viewAirport: null,
  activeFloor: null,
  alerts: []
};

const elements = {
  form: document.querySelector("#flight-form"),
  airline: document.querySelector("#airline"),
  flightNumber: document.querySelector("#flight-number"),
  flightDate: document.querySelector("#flight-date"),
  flightCard: document.querySelector("#flight-card"),
  wifiCard: document.querySelector("#wifi-card"),
  joinWifi: document.querySelector("#join-wifi"),
  alerts: document.querySelector("#alerts"),
  routeTitle: document.querySelector("#route-title"),
  routeMeta: document.querySelector("#route-meta"),
  routeSteps: document.querySelector("#route-steps"),
  map: document.querySelector("#map"),
  providerHealth: document.querySelector("#provider-health"),
  accessibleMode: document.querySelector("#accessible-mode"),
  trackButton: document.querySelector("#track-flight"),
  mapTitle: document.querySelector("#map-title"),
  airportSelect: document.querySelector("#airport-select"),
  mapAttribution: document.querySelector("#map-attribution"),
  mapLegend: document.querySelector("#map-legend"),
  scalebar: document.querySelector("#map-scalebar"),
  floorControls: document.querySelector("#floor-controls"),
  resetView: document.querySelector("#reset-view"),
  locateSecurity: document.querySelector("#locate-security"),
  locateArrival: document.querySelector("#locate-arrival"),
  useGps: document.querySelector("#use-gps")
};

elements.flightDate.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

bootstrap();

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setTracking(true);
  try {
    const itinerary = await state.provider.resolveFlight({
      airline: elements.airline.value.trim().toUpperCase(),
      flightNumber: elements.flightNumber.value.trim(),
      date: elements.flightDate.value
    }, { allowDemoFallback: state.providerStatus?.flight === "demo" });
    await applyItinerary(itinerary);
  } catch (error) {
    addAlert(`Could not resolve that flight: ${error.message}`);
  } finally {
    setTracking(false);
  }

  window.setTimeout(() => {
    if (!state.itinerary || state.itinerary.providerMode === "live") return;
    void applyItinerary(state.provider.simulateGateChange(state.itinerary, "A21"));
    addAlert("Demo gate changed to A21. Route recalculated.");
  }, 8000);
});

function setTracking(active) {
  if (!elements.trackButton) return;
  elements.trackButton.disabled = active;
  elements.trackButton.textContent = active ? "Tracking…" : "Track flight";
}

elements.accessibleMode.addEventListener("change", () => {
  state.accessible = elements.accessibleMode.checked;
  render();
});

elements.locateSecurity.addEventListener("click", () => setManualStartByKind("security"));
elements.locateArrival.addEventListener("click", () => setManualStartByKind("arrival"));

elements.airportSelect?.addEventListener("change", async () => {
  const airportCode = elements.airportSelect.value;
  if (!airportCode || airportCode === state.map?.airportCode) return;
  addAlert(`Loading ${airportCode} map...`);
  await loadAirportMap(airportCode);
  render();
});

elements.useGps.addEventListener("click", () => {
  if (!navigator.geolocation) {
    addAlert("GPS is not available in this browser. Choose a manual start point.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const reading = projectOutdoorGpsToTerminal(browserGpsReading(position), state.map);
      const node = nearestNode(state.map, reading);
      state.fromNodeId = node.id;
      state.activeFloor = node.floorId || state.activeFloor;
      state.positionConfidence = confidenceForReading(reading);
      addAlert(`GPS fix received with ${Math.round(reading.accuracyMeters)} m accuracy. Indoor confidence is ${state.positionConfidence}.`);
      render();
    },
    () => addAlert("Location permission was denied or unavailable. Manual start remains active."),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
  );
});

elements.joinWifi.addEventListener("click", async () => {
  const result = await connectToWifi(wifiProfileFor(state.map.airportCode));
  addAlert(result.message || (result.ok ? "Wi-Fi connection started." : "Wi-Fi connection needs manual setup."));
  renderWifi();
});

function setManualStartByKind(kind) {
  const node = state.map.nodes.find((candidate) => candidate.kind === kind);
  if (!node) {
    addAlert(`This ${state.map.airportCode} map has no mapped ${kind === "arrival" ? "entrance" : kind} point yet. Use GPS or stay on the default start.`);
    return;
  }
  const reading = manualReading(node);
  state.fromNodeId = node.id;
  state.activeFloor = node.floorId || state.activeFloor;
  state.positionConfidence = confidenceForReading(reading);
  addAlert(`Start set to ${node.label || node.id}.`);
  render();
}

async function bootstrap() {
  setupMapNavigation();
  await Promise.all([loadProviderStatus(), loadAirportCatalog()]);
  await loadAirportMap(state.catalogCodes?.[0] || "DFW");
  render();
}

async function loadAirportCatalog() {
  if (!elements.airportSelect) return;
  try {
    const response = await fetch("/api/airport-map/catalog");
    const catalog = await response.json();
    const entries = (catalog.entries || [])
      .slice()
      .sort((a, b) => a.airportCode.localeCompare(b.airportCode));
    if (!entries.length) return;
    elements.airportSelect.innerHTML = entries
      .map((entry) => `<option value="${escapeHtml(entry.airportCode)}">${escapeHtml(entry.airportCode)}${entry.routing === "approximate" ? " ≈" : ""}</option>`)
      .join("");
    state.catalogCodes = entries.map((entry) => entry.airportCode);
  } catch {
    // The selector simply stays empty when the catalog is unavailable.
  }
}

async function loadProviderStatus() {
  try {
    const response = await fetch("/api/providers");
    state.providerStatus = await response.json();
    renderProviderStatus();
  } catch {
    state.providerStatus = { flight: "demo", airportMap: "demo", wifi: "manual" };
    renderProviderStatus();
  }
}

async function loadAirportMap(airportCode) {
  try {
    const response = await fetch(`/api/airport-map?airport=${encodeURIComponent(airportCode)}`);
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error || "Airport map request failed.");
      error.productionRequired = Boolean(payload.productionRequired);
      error.diagnostics = payload.diagnostics;
      throw error;
    }
    state.map = payload.map;
    state.mapDiagnostics = payload.diagnostics || null;
    state.mapError = null;
    state.productionMapBlocked = false;
    state.fromNodeId = defaultStartNode(state.map);
    state.activeFloor = null;
    if (elements.airportSelect && state.catalogCodes?.includes(state.map.airportCode)) {
      elements.airportSelect.value = state.map.airportCode;
    }
    addAlert(`${state.map.airportCode} map loaded.`);
    if (state.map.routing === "approximate") {
      addAlert(`${state.map.airportCode} guidance is approximate — follow airport signage to confirm.`);
    }
  } catch (error) {
    state.mapDiagnostics = error.diagnostics || null;
    state.mapError = error.message;
    state.productionMapBlocked = Boolean(error.productionRequired);
    if (state.productionMapBlocked) {
      addAlert(`Production map blocked: ${error.message}`);
    } else {
      state.map = demoAirportMap;
      addAlert(`Live map unavailable: ${error.message}. Using demo DFW map.`);
    }
  }
}

async function applyItinerary(itinerary) {
  const previousGate = state.itinerary?.legs?.[0]?.gate;
  state.itinerary = itinerary;
  const activeLeg = itinerary.legs[0];

  if (activeLeg.origin && activeLeg.origin !== state.map.airportCode) {
    await loadAirportMap(activeLeg.origin);
  }

  state.destinationNodeId = resolveDestinationNode(activeLeg.gate);
  const risk = summarizeConnectionRisk(itinerary);

  for (const warning of itinerary.warnings || []) {
    addAlert(warning.includes("gate assignment")
      ? "The airline hasn't published a gate for this flight yet."
      : warning);
  }
  if (previousGate && previousGate !== activeLeg.gate) {
    addAlert(`Gate changed from ${previousGate} to ${activeLeg.gate}.`);
  }
  if (risk) addAlert(risk.message);

  render();
}

function resolveDestinationNode(gate) {
  if (gate) {
    try {
      return placeToNode(state.map, gate.toLowerCase());
    } catch {
      addAlert(`Gate ${gate} is not present in the loaded ${state.map.airportCode} map. Routing to the closest known gate.`);
    }
  } else {
    addAlert("Live provider did not return a gate yet. Routing to the first known departure gate.");
  }

  return state.map.places.find((place) => place.kind === "gate")?.nodeId || state.map.nodes[0].id;
}

function defaultStartNode(map) {
  return map.nodes.find((node) => node.kind === "security")?.id
    || map.nodes.find((node) => node.kind === "arrival")?.id
    || map.nodes.find((node) => node.kind === "gate")?.id
    || map.nodes[0].id;
}

function addAlert(message) {
  state.alerts = [message, ...state.alerts].slice(0, 6);
  renderAlerts();
}

function currentRoute() {
  if (state.productionMapBlocked) {
    return {
      ok: false,
      reason: state.mapError || "Production map is unavailable.",
      path: [],
      meters: 0,
      etaMinutes: null,
      steps: []
    };
  }

  // Node ids from a previously loaded airport must never leak into routing
  // on the current map (e.g. after the live flight switches airports).
  if (!state.map.nodes.some((node) => node.id === state.fromNodeId)) {
    state.fromNodeId = defaultStartNode(state.map);
  }
  if (!state.map.nodes.some((node) => node.id === state.destinationNodeId)) {
    state.destinationNodeId = state.map.places.find((place) => place.kind === "gate")?.nodeId
      || state.map.nodes[0].id;
  }

  // Gate-position-only bundles have no mapped corridors: give signage-based
  // guidance with an explicitly approximate distance instead of a fake route.
  if (state.map.routing === "approximate") {
    const from = getNode(state.map, state.fromNodeId);
    const to = getNode(state.map, state.destinationNodeId);
    const directMeters = Math.hypot(to.x - from.x, to.y - from.y);
    const meters = directMeters * 1.4;
    const etaMinutes = Math.max(1, Math.ceil(meters / 72));
    return {
      ok: true,
      approximate: true,
      path: [from.id, to.id],
      meters,
      etaMinutes,
      confidence: "approximate",
      steps: [
        `Follow airport signage toward gate ${to.label || state.map.airportCode}.`,
        `Approximate walk ${formatDistance(meters)}, about ${etaMinutes} min.`,
        "Turn-by-turn directions aren't available at this airport yet — gate positions shown are exact."
      ]
    };
  }

  // A landside start (entrance / arrival hall) must pass through security
  // before reaching any gate.
  const startNode = state.map.nodes.find((node) => node.id === state.fromNodeId);
  let via;
  if (startNode?.kind === "arrival") {
    const security = state.map.nodes
      .filter((node) => node.kind === "security")
      .sort((a, b) => Math.hypot(a.x - startNode.x, a.y - startNode.y) - Math.hypot(b.x - startNode.x, b.y - startNode.y))[0];
    via = security?.id;
  }

  return routeBetween(state.map, state.fromNodeId, state.destinationNodeId, {
    accessible: state.accessible,
    positionConfidence: state.positionConfidence,
    via
  });
}

function render() {
  renderProviderStatus();
  renderFlight();
  renderWifi();
  renderAlerts();
  renderMap(currentRoute());
}

function renderProviderStatus() {
  if (!elements.providerHealth) return;
  const status = state.providerStatus;
  if (!status) {
    elements.providerHealth.textContent = "Connecting…";
    return;
  }
  const flightLive = ["flightaware-aeroapi", "live-adsb", "opensky-network"].includes(status.flight);
  const mapLive = ["bundled-osm-maps", "production-map-catalog", "production-map-bundles"].includes(status.airportMap);
  const label = flightLive && mapLive ? "Live data" : flightLive || mapLive ? "Partial live data" : "Demo mode";
  elements.providerHealth.textContent = label;
  elements.providerHealth.classList.toggle("degraded", !(flightLive && mapLive));
  // Technical detail stays available on hover without cluttering the UI.
  elements.providerHealth.title = `Flight provider: ${status.flight} · Map source: ${status.airportMap}`;
}

function renderFlight() {
  const leg = state.itinerary?.legs?.[0];
  if (!leg) {
    elements.flightCard.innerHTML = "<p>Enter a flight to load gate, terminal, and status.</p>";
    return;
  }

  const updated = new Date(leg.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  elements.flightCard.innerHTML = [
    row("Flight", `${leg.airlineName || leg.airline} ${leg.flightNumber}`),
    row("Route", `${leg.origin || "—"} → ${leg.destination || "—"}`),
    row("Terminal / gate", `${leg.terminal || "—"} / ${leg.gate || "not published yet"}`),
    row("Status", humanizeStatus(leg.status)),
    row("Updated", `${updated}${state.itinerary.providerMode === "live" ? " · live" : ""}`)
  ].join("");
}

function humanizeStatus(status) {
  const cleaned = String(status || "")
    .replace(/\s*\(live ADS-B[^)]*\)/, "")
    .replace(/\s*\(route on record, live ADS-B\)/, "")
    .trim() || "status unavailable";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function renderWifi() {
  const profile = wifiProfileFor(state.map.airportCode);
  elements.wifiCard.innerHTML = [
    row("Network", profile.ssid),
    `<p>${profile.instructions.join(" ")}</p>`
  ].join("");
}

function renderAlerts() {
  elements.alerts.innerHTML = state.alerts.map((alert) => `<li>${escapeHtml(alert)}</li>`).join("");
}

// ---- Blueprint x-ray view and navigation ----------------------------------

function pointsAttr(points) {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

// Terminal entries are {points, name} in current bundles; older bundles used
// bare point arrays.
function terminalShape(entry) {
  return Array.isArray(entry) ? { points: entry, name: null } : entry;
}

function projectedBounds(map, padding = 70) {
  const points = map.nodes.map((node) => [node.x, node.y]);
  for (const entry of map.layers?.terminals || []) {
    for (const point of terminalShape(entry).points) points.push(point);
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  return {
    minX,
    minY,
    width: Math.max(...xs) + padding - minX,
    height: Math.max(...ys) + padding - minY
  };
}

function mapFloors(map) {
  const floors = (map.floors || []).map((floor) => floor.id);
  return floors.sort((a, b) => parseFloat(a.slice(1)) - parseFloat(b.slice(1)));
}

function floorOfNode(map, nodeId) {
  return map.nodes.find((node) => node.id === nodeId)?.floorId || null;
}

// Elements away from the traveler's floor stay visible but ghosted — the
// x-ray look: you see the whole building, your floor is the bright one.
function offFloor(map, floorId) {
  if (!state.activeFloor || !floorId) return "";
  return floorId === state.activeFloor ? "" : " off-floor";
}

function applyView() {
  if (!state.view) return;
  elements.map.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);

  // Level of detail follows zoom: amenity labels appear close-up, all labels
  // retire when the whole airfield is in frame. Pure CSS class flips — the
  // geometry is never re-rendered while navigating.
  if (state.focusW) {
    const ratio = state.view.w / state.focusW;
    elements.map.classList.toggle("lod-near", ratio < 0.55);
    elements.map.classList.toggle("lod-far", ratio > 1.7);
  }

  // Re-place labels when the zoom level meaningfully changes (pan alone
  // never affects label layout, so dragging stays free).
  if (state.labelZoomW && Math.abs(Math.log(state.view.w / state.labelZoomW)) > 0.12) {
    scheduleLabelRelayout();
  }

  // Dynamic scale bar: pick a round distance that renders 60-160 px wide.
  if (elements.scalebar) {
    const widthPx = elements.map.clientWidth || 800;
    const metersPerPx = state.view.w / widthPx;
    const nice = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
      .find((candidate) => candidate / metersPerPx >= 60 && candidate / metersPerPx <= 180);
    if (nice) {
      elements.scalebar.style.width = `${Math.round(nice / metersPerPx)}px`;
      elements.scalebar.textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
      elements.scalebar.style.display = "block";
    } else {
      elements.scalebar.style.display = "none";
    }
  }
}

function resetView() {
  state.view = null;
  render();
}

function setupMapNavigation() {
  const svg = elements.map;
  if (!svg) return;

  svg.addEventListener("wheel", (event) => {
    if (!state.view) return;
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const factor = event.deltaY > 0 ? 1.18 : 1 / 1.18;
    const width = Math.min(Math.max(state.view.w * factor, 40), 60000);
    const height = width * (state.view.h / state.view.w);
    state.view.x += (state.view.w - width) * fx;
    state.view.y += (state.view.h - height) * fy;
    state.view.w = width;
    state.view.h = height;
    applyView();
  }, { passive: false });

  let drag = null;
  svg.addEventListener("pointerdown", (event) => {
    if (!state.view) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("dragging");
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id || !state.view) return;
    const rect = svg.getBoundingClientRect();
    state.view.x -= (event.clientX - drag.x) * (state.view.w / rect.width);
    state.view.y -= (event.clientY - drag.y) * (state.view.h / rect.height);
    drag = { id: drag.id, x: event.clientX, y: event.clientY };
    applyView();
  });
  const endDrag = () => {
    drag = null;
    svg.classList.remove("dragging");
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("dblclick", resetView);

  elements.resetView?.addEventListener("click", resetView);
  elements.floorControls?.addEventListener("click", (event) => {
    const floorId = event.target?.dataset?.floor;
    if (!floorId) return;
    state.activeFloor = floorId;
    render();
  });
}

function renderBlueprintLayers(map, s) {
  const layers = map.layers || {};
  const parts = [];

  for (const apron of layers.aprons || []) {
    parts.push(`<polygon class="bp-apron" points="${pointsAttr(apron)}" stroke-width="${1.2 * s}"></polygon>`);
  }
  for (const taxiway of layers.taxiways || []) {
    parts.push(`<polyline class="bp-taxiway" points="${pointsAttr(taxiway)}" stroke-width="12"></polyline>`);
  }
  for (const runway of layers.runways || []) {
    parts.push(`<polyline class="bp-runway" points="${pointsAttr(runway.points)}" stroke-width="${runway.width}"></polyline>`);
    parts.push(`<polyline class="bp-runway-center" points="${pointsAttr(runway.points)}" stroke-width="${1.6 * s}" stroke-dasharray="30 22"></polyline>`);
  }

  // X-ray shells: the building outline is bright, the interior is a faint
  // wash so the corridors, gates, and route inside stay fully readable.
  // (Names are drawn by the label engine, which handles collisions.)
  for (const entry of layers.terminals || []) {
    const { points } = terminalShape(entry);
    parts.push(`<polygon class="bp-terminal-xray" points="${pointsAttr(points)}" stroke-width="${2 * s}"></polygon>`);
  }
  return parts.join("");
}

// ---- Label engine ----------------------------------------------------------
// Labels keep a constant on-screen size (like any professional map) and are
// placed with a greedy priority pass: whatever would overlap something more
// important is dropped, and more labels appear as you zoom in. Only this
// layer re-renders on zoom — the geometry never does.

function renderLabels() {
  const layer = elements.map?.querySelector("#bp-label-layer");
  if (!layer || !state.view || state.productionMapBlocked) return;
  const map = state.map;
  state.labelZoomW = state.view.w;

  const pxPerWorld = (elements.map.clientWidth || 800) / state.view.w;
  const worldSize = (px) => px / pxPerWorld;
  const zoomRatio = state.focusW ? state.view.w / state.focusW : 1;

  const candidates = [];

  for (const entry of map.layers?.terminals || []) {
    const { points, name } = terminalShape(entry);
    if (!name || points.length < 3) continue;
    const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    candidates.push({ x: cx, y: cy, text: name, cls: "bp-terminal-label", size: worldSize(12), priority: 80, anchor: "middle" });
  }

  for (const place of map.places) {
    const node = map.nodes.find((candidate) => candidate.id === place.nodeId);
    if (!node || !place.label) continue;
    const isDestination = place.nodeId === state.destinationNodeId && place.kind === "gate";
    // Off-floor labels are pure clutter; amenities only earn space close-up.
    if (offFloor(map, node.floorId) && !isDestination) continue;
    if (place.kind === "amenity" && zoomRatio > 0.55) continue;
    const priority = isDestination ? 1000
      : place.kind === "security" ? 90
        : place.kind === "arrival" ? 85
          : place.kind === "gate" ? 60
            : 20;
    const size = worldSize(place.kind === "gate" ? 13 : 12);
    candidates.push({
      x: node.x + worldSize(9),
      y: node.y + size * 0.36,
      text: place.label,
      cls: `bp-${place.kind}${isDestination ? " destination" : ""}`,
      size,
      priority,
      anchor: "start"
    });
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const kept = [];
  for (const candidate of candidates) {
    const width = candidate.text.length * candidate.size * 0.62 + candidate.size;
    const x = candidate.anchor === "middle" ? candidate.x - width / 2 : candidate.x - candidate.size * 0.3;
    const box = { x, y: candidate.y - candidate.size * 1.05, w: width, h: candidate.size * 1.45 };
    const collides = kept.some((placed) =>
      box.x < placed.box.x + placed.box.w && placed.box.x < box.x + box.w
      && box.y < placed.box.y + placed.box.h && placed.box.y < box.y + box.h);
    if (!collides) kept.push({ candidate, box });
  }

  layer.innerHTML = kept.map(({ candidate }) =>
    `<text class="map-label ${candidate.cls}" x="${Math.round(candidate.x * 10) / 10}" y="${Math.round(candidate.y * 10) / 10}" font-size="${Math.round(candidate.size * 10) / 10}"${candidate.anchor === "middle" ? ` text-anchor="middle"` : ""}>${escapeHtml(candidate.text)}</text>`
  ).join("");
}

function scheduleLabelRelayout() {
  window.clearTimeout(state.labelTimer);
  state.labelTimer = window.setTimeout(renderLabels, 120);
}

function renderFloorControls(map) {
  if (!elements.floorControls) return;
  const floors = mapFloors(map);
  if (floors.length < 2) {
    elements.floorControls.innerHTML = "";
    return;
  }
  elements.floorControls.innerHTML = floors
    .map((floorId) => `<button type="button" class="map-button floor-button${floorId === state.activeFloor ? " active" : ""}" data-floor="${escapeHtml(floorId)}" aria-pressed="${floorId === state.activeFloor}">${escapeHtml(floorId.replace(/^L/, "Lvl "))}</button>`)
    .join("");
}

function renderMap(route) {
  if (elements.mapTitle) {
    elements.mapTitle.textContent = state.productionMapBlocked
      ? "Airport map"
      : state.map.name || state.map.airportCode || "Airport map";
  }

  if (state.productionMapBlocked) {
    elements.routeTitle.textContent = "Production map unavailable";
    elements.routeMeta.textContent = state.mapError || "Map provider is not configured.";
    elements.routeSteps.innerHTML = "<li>Configure a production airport map catalog or bundle host before routing.</li>";
    elements.map.setAttribute("viewBox", "0 0 920 560");
    elements.map.innerHTML = `
      <rect class="terminal-wall" x="34" y="92" width="852" height="384" rx="8"></rect>
      <text class="place-label" x="100" y="250">Production airport map required</text>
      <text class="place-label" x="100" y="290">${escapeHtml(state.mapError || "No production map loaded")}</text>
    `;
    return;
  }

  const map = state.map;
  if (!map.nodes.some((node) => node.id === state.fromNodeId)) {
    state.fromNodeId = defaultStartNode(map);
  }
  if (!map.nodes.some((node) => node.id === state.destinationNodeId)) {
    state.destinationNodeId = map.places.find((place) => place.kind === "gate")?.nodeId || map.nodes[0].id;
  }

  const routeNodes = route.path.map((nodeId) => getNode(map, nodeId));
  const activeGate = getNode(map, state.destinationNodeId).label;
  elements.routeTitle.textContent = route.ok
    ? route.approximate
      ? `Toward gate ${activeGate} (approximate)`
      : `Route to gate ${activeGate}`
    : "No route available";
  elements.routeMeta.innerHTML = route.ok
    ? `${route.approximate ? "≈ " : ""}${formatDistance(route.meters)}<br>${route.etaMinutes} min walk${route.approximate ? "<br>approximate" : ""}`
    : escapeHtml(route.reason);

  elements.routeSteps.innerHTML = route.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");

  const bounds = projectedBounds(map);
  // Initial view frames the gate/terminal area; the wider airfield
  // (runways, taxiways) is there to discover by zooming out.
  const fxs = map.nodes.map((node) => node.x);
  const fys = map.nodes.map((node) => node.y);
  const focus = {
    x: Math.min(...fxs) - 90,
    y: Math.min(...fys) - 90,
    w: Math.max(...fxs) - Math.min(...fxs) + 180,
    h: Math.max(...fys) - Math.min(...fys) + 180
  };
  state.focusW = focus.w;
  if (!state.view || state.viewAirport !== map.airportCode) {
    state.view = { ...focus };
    state.viewAirport = map.airportCode;
  }
  applyView();

  // The bright floor follows the traveler's position unless they picked one.
  const floors = mapFloors(map);
  if (!state.activeFloor || !floors.includes(state.activeFloor)) {
    state.activeFloor = floorOfNode(map, state.fromNodeId) || floors[0] || null;
  }
  renderFloorControls(map);

  // Stroke widths, dot radii, and label sizes are expressed in viewBox units,
  // scaled relative to the focused terminal area (not the full airfield) so
  // gates stay readable at the default zoom.
  const s = Math.max(0.4, focus.w / 920);

  if (elements.mapAttribution) {
    elements.mapAttribution.textContent = state.map.attribution || "";
  }
  if (elements.mapLegend) {
    elements.mapLegend.textContent = `${map.airportCode} · gate guide blueprint · drag to pan · scroll to zoom`;
  }

  // The blueprint paper and grid extend well past the data so panning never
  // reveals a hard edge.
  const gx = bounds.minX - bounds.width;
  const gy = bounds.minY - bounds.height;
  const gw = bounds.width * 3;
  const gh = bounds.height * 3;

  const routePath = pointsAttr(routeNodes.map((node) => [node.x, node.y]));
  elements.map.innerHTML = `
    <defs>
      <pattern id="bp-grid" width="100" height="100" patternUnits="userSpaceOnUse">
        <path d="M 100 0 L 0 0 0 100" fill="none" class="bp-grid-line" stroke-width="${0.7 * s}"></path>
      </pattern>
    </defs>
    <rect class="bp-paper" x="${gx}" y="${gy}" width="${gw}" height="${gh}"></rect>
    <rect fill="url(#bp-grid)" x="${gx}" y="${gy}" width="${gw}" height="${gh}"></rect>
    ${renderBlueprintLayers(map, s)}
    ${map.edges.map((edge) => renderEdge(map, edge, s)).join("")}
    ${route.ok ? `<polyline class="route-halo" points="${routePath}" stroke-width="${20 * s}"></polyline><polyline class="route-line" points="${routePath}" stroke-width="${8 * s}"${route.approximate ? ` stroke-dasharray="${14 * s} ${12 * s}" opacity="0.85"` : ""}></polyline>` : ""}
    ${map.places.map((place) => renderPlace(map, place, s)).join("")}
    ${renderUserDot(map, s)}
    <g id="bp-label-layer"></g>
  `;
  renderLabels();
}

function renderEdge(map, edge, s = 1) {
  const from = getNode(map, edge.from);
  const to = getNode(map, edge.to);
  const closed = isEdgeClosed(map, edge.from, edge.to) ? " closed" : "";
  const dash = closed ? ` stroke-dasharray="${10 * s} ${8 * s}"` : "";
  return `<line class="map-edge${closed}${offFloor(map, from.floorId)}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke-width="${5 * s}"${dash}></line>`;
}

function renderPlace(map, place, s = 1) {
  const node = getNode(map, place.nodeId);
  const ghost = offFloor(map, node.floorId);
  const isDestination = place.nodeId === state.destinationNodeId && place.kind === "gate";
  const ring = isDestination
    ? `<circle class="dest-ring" cx="${node.x}" cy="${node.y}" r="${20 * s}" stroke-width="${3 * s}"></circle>`
    : "";
  return `
    ${ring}
    <circle class="place-dot bp-${place.kind}${isDestination ? " destination" : ""}${ghost}" cx="${node.x}" cy="${node.y}" r="${place.kind === "gate" ? 10 * s : 7 * s}" stroke-width="${2.5 * s}"></circle>
  `;
}

function renderUserDot(map, s = 1) {
  const node = getNode(map, state.fromNodeId);
  return `<circle class="user-halo" cx="${node.x}" cy="${node.y}" r="${24 * s}"></circle><circle class="user-dot" cx="${node.x}" cy="${node.y}" r="${13 * s}" stroke-width="${5 * s}"></circle>`;
}

function row(label, value) {
  return `<div class="data-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

render();
