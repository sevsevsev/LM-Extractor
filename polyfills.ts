/**
 * `Map`/`WeakMap.prototype.getOrInsertComputed` — TC39 "Map/Set upsert" proposal.
 * `pdfjs-dist` (used unconditionally, no fallback, since at least 4.10 through 6.3) calls this on
 * every page render (`getOptionalContentConfig` and friends). As of Chromium 141 (2026-09) this
 * method has not shipped in any stable browser engine, so PDF rendering throws
 * `TypeError: ...getOrInsertComputed is not a function` on every page — a hard crash for both
 * direct PDF uploads and PPTX (which round-trips through the same PDF renderer).
 * No-ops once a browser ships the real method — safe to remove then.
 * Must run before pdfjs-dist's own module evaluates, hence imported first in index.tsx.
 */
function installGetOrInsertComputedPolyfill(ctor: typeof Map | typeof WeakMap): void {
  const proto = ctor.prototype as { getOrInsertComputed?: unknown };
  if (typeof proto.getOrInsertComputed === 'function') return;
  Object.defineProperty(proto, 'getOrInsertComputed', {
    configurable: true,
    writable: true,
    value: function <K, V>(this: Map<K, V> | WeakMap<K & object, V>, key: K, computeValue: (key: K) => V): V {
      if (!this.has(key as never)) {
        this.set(key as never, computeValue(key));
      }
      return this.get(key as never) as V;
    },
  });
}

installGetOrInsertComputedPolyfill(Map);
installGetOrInsertComputedPolyfill(WeakMap);
