import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeClientError } from "../../../src/runtime-client/index.ts";
import { runtimeUrl } from "../../../src/web/lib/runtime.ts";

test("runtimeUrl accepts IPv4, localhost, and bracketed IPv6 loopback", (t) => {
  const previous = process.env.SYMPHONEER_RUNTIME_URL;
  t.after(() => {
    if (previous === undefined) delete process.env.SYMPHONEER_RUNTIME_URL;
    else process.env.SYMPHONEER_RUNTIME_URL = previous;
  });

  process.env.SYMPHONEER_RUNTIME_URL = "http://127.0.0.1:4318/";
  assert.equal(runtimeUrl(), "http://127.0.0.1:4318");

  process.env.SYMPHONEER_RUNTIME_URL = "http://localhost:4318";
  assert.equal(runtimeUrl(), "http://localhost:4318");

  process.env.SYMPHONEER_RUNTIME_URL = "http://[::1]:4318";
  assert.equal(runtimeUrl(), "http://[::1]:4318");

  process.env.SYMPHONEER_RUNTIME_URL = "http://example.com:4318";
  assert.throws(
    () => runtimeUrl(),
    (error) => error instanceof RuntimeClientError && error.code === "invalid_runtime_url",
  );
});
