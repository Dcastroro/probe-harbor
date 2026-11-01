import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { HarborError, runProbes, validateConfig } from "../src/index.mjs";

const check = (id = "api", url = "http://127.0.0.1:1/ready") => ({ id, url });
const invalid = (error) =>
  error instanceof HarborError &&
  error.code === "invalid-config" &&
  error.message === "invalid-config";
function configuration(collection, hole, length = 3) {
  const config = { version: 1, checks: [check()] };
  if (collection === "checks") {
    config.checks = Array.from({ length }, (_, index) => check(`api-${index}`));
    delete config.checks[hole];
  } else {
    const values = Array.from({ length }, (_, index) =>
      collection === "expectedStatus"
        ? 200 + index
        : { pointer: "/ready", equals: true },
    );
    delete values[hole];
    config.checks[0][collection] = values;
  }
  return config;
}

for (const collection of ["checks", "expectedStatus", "assertions"]) {
  for (const hole of [0, 1, 2]) {
    test(`rejects a hole at index ${hole} in ${collection}`, () => {
      assert.throws(
        () => validateConfig(configuration(collection, hole)),
        invalid,
      );
    });
  }
  test(`rejects a wholly sparse ${collection} array`, () => {
    assert.throws(
      () => validateConfig(configuration(collection, 0, 1)),
      invalid,
    );
  });
}

test("inherited array entries cannot replace missing own checks", () => {
  const checks = new Array(1);
  const prototype = Object.create(Array.prototype);
  prototype[0] = check();
  Object.setPrototypeOf(checks, prototype);
  assert.throws(() => validateConfig({ version: 1, checks }), invalid);
});

test("oversized sparse arrays fail the existing length bounds", () => {
  for (const collection of ["checks", "expectedStatus", "assertions"]) {
    const config = { version: 1, checks: [check()] };
    if (collection === "checks") config.checks = new Array(0xffffffff);
    else config.checks[0][collection] = new Array(0xffffffff);
    assert.throws(() => validateConfig(config), invalid);
  }
});

test("dense checks, statuses and an empty or populated assertion list remain valid", () => {
  for (const assertions of [[], [{ pointer: "/ready", equals: true }]]) {
    assert.deepEqual(
      validateConfig({
        version: 1,
        checks: [{ ...check(), expectedStatus: [200, 204], assertions }],
      }),
      { version: 1, valid: true, checks: 1 },
    );
  }
});

test("all configuration arrays are validated before any loopback request starts", async (t) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.setHeader("content-type", "application/json");
    response.end('{"ready":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const url = `http://127.0.0.1:${server.address().port}/ready`;
  for (const collection of ["checks", "expectedStatus", "assertions"]) {
    const config = configuration(collection, 1);
    // Keep a valid first check: validation must finish before starting its work.
    if (collection !== "checks") config.checks.unshift(check("first", url));
    config.checks[0].url = url;
    await assert.rejects(runProbes(config), invalid);
    assert.equal(requests, 0);
  }
});
