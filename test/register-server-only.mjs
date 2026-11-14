// Node CLI integration tests use Vitest's no-op. Next enforces this boundary
// in production; plain Node has no Next module resolver.
import Module from "node:module";
import { fileURLToPath } from "node:url";
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return fileURLToPath(new URL("./server-only-stub.ts", import.meta.url));
  return original.call(this, request, ...args);
};
