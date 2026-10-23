// Loads script.js (a browser IIFE) in a vm sandbox with a stub DOM and
// returns the internal detection functions, without modifying script.js.
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8')
  .replace(/\}\)\(\);\s*$/, 'globalThis.__scrub = { inspectJpeg, scanPngChunks, scanWebpChunks, detectMetadata };})();');

const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
const context = vm.createContext({
  document: { getElementById: () => stub },
  TextDecoder, Uint8Array, DataView, URL
});
vm.runInContext(source, context);

// Results are copied into this realm so strict deep-equality works on them.
const plain = (fn) => (...args) => {
  const result = fn(...args);
  return result === null ? null : JSON.parse(JSON.stringify(result));
};
export const inspectJpeg = plain(context.__scrub.inspectJpeg);
export const scanPngChunks = plain(context.__scrub.scanPngChunks);
export const scanWebpChunks = plain(context.__scrub.scanWebpChunks);
export const detectMetadata = plain(context.__scrub.detectMetadata);

export function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}
