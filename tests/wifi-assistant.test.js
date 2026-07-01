import test from "node:test";
import assert from "node:assert/strict";
import { connectToWifi, wifiCapability } from "../public/app-assets/wifi-assistant.js";

test("web-only mode returns manual instructions", async () => {
  const result = await connectToWifi({ ssid: "Airport", trusted: true, security: "open" }, null);
  assert.equal(result.ok, false);
  assert.equal(result.status, "manual-required");
});

test("refuses untrusted network auto-join", async () => {
  const result = await connectToWifi({ ssid: "EvilTwin", trusted: false }, {
    wifi: { joinTrustedNetwork: async () => ({ ok: true }) }
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "refused");
});

test("detects native auto-join capability", () => {
  const capability = wifiCapability({
    platform: "ios",
    wifi: { joinTrustedNetwork: async () => ({ ok: true }) }
  });
  assert.equal(capability.canAutoJoin, true);
  assert.equal(capability.platform, "ios");
});
