import test from "node:test";
import assert from "node:assert/strict";
import {
  applySyncEvents,
  createDeviceIdentity,
  createPairingInvitation,
  createSyncEvent,
  parsePairingInvitation,
  verifySyncEvent
} from "../src/core/device-sync.js";

test("device identity is accountless and portable", () => {
  const identity = createDeviceIdentity({
    deviceId: "device-a",
    publicKey: "ed25519-public-key",
    label: "Phone"
  });
  assert.equal(identity.deviceId, "device-a");
  assert.equal(identity.publicKey, "ed25519-public-key");
  assert.equal(identity.label, "Phone");
  assert.equal(identity.accountId, undefined);
});

test("pairing invitation round-trips through QR payload without an account", () => {
  const inviter = createDeviceIdentity({
    deviceId: "device-a",
    publicKey: "public-a"
  });
  const invitation = createPairingInvitation({
    networkId: "network-1",
    inviter,
    expiresAt: "2999-01-01T00:00:00.000Z",
    nonce: "00112233445566778899aabbccddeeff"
  });
  const parsed = parsePairingInvitation(invitation.qrPayload);
  assert.equal(parsed.networkId, "network-1");
  assert.equal(parsed.inviter.deviceId, "device-a");
  assert.equal(parsed.nonce, invitation.nonce);
});

test("sync events are integrity-verifiable and idempotent", () => {
  const event = createSyncEvent({
    networkId: "network-1",
    deviceId: "device-a",
    sequence: 1,
    category: "routingPolicies",
    path: "default.mode",
    value: "proxy"
  });
  assert.equal(verifySyncEvent(event).ok, true);
  assert.equal(verifySyncEvent({ ...event, value: "direct" }).ok, false);

  const result = applySyncEvents([event, event], {
    networkId: "network-1"
  });
  assert.deepEqual(result.state, { default: { mode: "proxy" } });
  assert.deepEqual(result.acceptedEventIds, ["device-a:1"]);
});

test("sync payload rejects device-local secrets and runtime state", () => {
  assert.throws(
    () => createSyncEvent({
      networkId: "network-1",
      deviceId: "device-a",
      sequence: 1,
      category: "appPreferences",
      path: "security",
      value: { deviceSecrets: "must-not-sync" }
    }),
    /device-local secret/
  );
});
