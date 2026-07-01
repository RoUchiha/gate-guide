import test from "node:test";
import assert from "node:assert/strict";
import { demoAirportMap } from "../public/app-assets/sample-data.js";
import { nearestNode, routeBetween } from "../public/app-assets/router.js";

test("routes around active closures", () => {
  const route = routeBetween(demoAirportMap, "security-a", "gate-a18");
  assert.equal(route.ok, true);
  assert.deepEqual(route.path, ["security-a", "junction-a1", "junction-a2", "gate-a18"]);
  assert.equal(route.meters, 212);
});

test("accessible mode avoids inaccessible edges and closed paths", () => {
  const route = routeBetween(demoAirportMap, "security-a", "gate-a18", { accessible: true });
  assert.equal(route.ok, true);
  assert.deepEqual(route.path, ["security-a", "junction-a1", "elevator-a", "gate-a12", "junction-a2", "gate-a18"]);
  assert.equal(route.meters, 350);
});

test("returns no route when closures and accessibility block all paths", () => {
  const map = structuredClone(demoAirportMap);
  map.closures.push({ edgeKey: "gate-a12::junction-a2", reason: "test" });
  const route = routeBetween(map, "security-a", "gate-a18", { accessible: true });
  assert.equal(route.ok, false);
});

test("nearestNode honors floor when available", () => {
  const node = nearestNode(demoAirportMap, { floorId: "F1", x: 758, y: 274 });
  assert.equal(node.id, "gate-a18");
});
