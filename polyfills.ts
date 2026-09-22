/**
 * Two methods `pdfjs-dist` calls unconditionally, with no feature check and no fallback, neither of
 * which has shipped in a stable browser engine as of Chromium 141 (2026-09):
 *
 * - `Map`/`WeakMap.prototype.getOrInsertComputed` (TC39 "Map/Set upsert"). pdf.js reaches for it
 *   whenever it merges two resource dictionaries — `Dict.merge`, which `Page.resources` hits on any
 *   PDF declaring `/Resources` at more than one level of the page tree, and `#getMergedResources`
 *   hits when a content stream carries its own. Without it, every page render and every text read
 *   on such a document throws `UnknownErrorException`.
 * - `Math.sumPrecise` (TC39 "Math.sumPrecise"). pdf.js uses it while rebuilding an embedded
 *   TrueType font's `glyf`/`loca` tables. Without it the embedded font fails to load and pdf.js
 *   silently substitutes a standard one addressed by raw glyph index, so the page still renders but
 *   its text comes out as mojibake — "Human" as "Hu#a$", "1,100" as "?,?..". Rasters that look
 *   plausible at a glance and are unreadable to a vision model are worse than a hard failure.
 *
 * Both no-op once a browser ships the real method — safe to delete then.
 *
 * BOTH REALMS, NOT JUST THIS ONE. pdf.js does its parsing, font sanitisation and rendering inside a
 * module Web Worker, which has its own global scope and therefore its own `Map.prototype` and its
 * own `Math`. Installing here patches the main thread only, which is the state this file shipped in
 * until 2026-09-22: PDFs needing a resource merge failed to convert at all, and PowerPoint — which
 * round-trips through the same PDF renderer — fell back to text-only on every deck while reporting
 * nothing worse than a warning. `PDF_WORKER_POLYFILL_SOURCE` below is the worker's copy; it is
 * prepended to pdf.js's own worker by `services/pdfWorkerSrc.ts`.
 *
 * Must run before pdfjs-dist's own module evaluates, hence imported first in index.tsx.
 */
export function installGetOrInsertComputedPolyfill(ctor: typeof Map | typeof WeakMap): void {
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

/**
 * Neumaier compensated summation rather than a plain `reduce`: `Math.sumPrecise` is specified to be
 * exactly rounded, and pdf.js sums fractional glyph advance widths with it as well as integer byte
 * offsets. Plain accumulation is already exact for the offsets and not for the widths, and quietly
 * disagreeing with the real method on the fractional case is how a polyfill becomes a bug once it
 * outlives the memory of why it exists.
 */
export function installSumPrecisePolyfill(math: Math): void {
  if (typeof (math as { sumPrecise?: unknown }).sumPrecise === 'function') return;
  Object.defineProperty(math, 'sumPrecise', {
    configurable: true,
    writable: true,
    value: function (values: Iterable<number>): number {
      let sum = 0;
      let compensation = 0;
      for (const raw of values) {
        const value = Number(raw);
        const next = sum + value;
        compensation +=
          Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
        sum = next;
      }
      return sum + compensation;
    },
  });
}

/**
 * The same two polyfills as executable source, for the one realm this module cannot reach by
 * importing: pdf.js's Web Worker.
 *
 * WHY THIS IS WRITTEN OUT RATHER THAN STRINGIFIED FROM THE FUNCTIONS ABOVE. `fn.toString()` returns
 * whatever the bundler emitted, not what is written here, and esbuild under `keepNames` wraps every
 * function body in a `__name(...)` call. That helper exists in the bundle's scope and not in a bare
 * worker, so a stringified copy throws `ReferenceError: __name is not defined` on the worker's first
 * line — which is a worse failure than the one this file exists to fix, and one that only appears
 * under a build configuration nobody is looking at. So the worker gets plain source, and
 * `polyfills.test.ts` holds the two copies to the same behaviour instead.
 *
 * Keep it ES5-plain and dependency-free: it runs before anything else in the worker.
 */
export const PDF_WORKER_POLYFILL_SOURCE = `
(function () {
  function installGetOrInsertComputed(ctor) {
    if (typeof ctor.prototype.getOrInsertComputed === 'function') return;
    Object.defineProperty(ctor.prototype, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value: function (key, computeValue) {
        if (!this.has(key)) {
          this.set(key, computeValue(key));
        }
        return this.get(key);
      },
    });
  }
  installGetOrInsertComputed(Map);
  installGetOrInsertComputed(WeakMap);

  if (typeof Math.sumPrecise !== 'function') {
    Object.defineProperty(Math, 'sumPrecise', {
      configurable: true,
      writable: true,
      value: function (values) {
        var sum = 0;
        var compensation = 0;
        for (var iter = values[Symbol.iterator](), step; !(step = iter.next()).done; ) {
          var value = Number(step.value);
          var next = sum + value;
          compensation +=
            Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
          sum = next;
        }
        return sum + compensation;
      },
    });
  }
})();
`;

installGetOrInsertComputedPolyfill(Map);
installGetOrInsertComputedPolyfill(WeakMap);
installSumPrecisePolyfill(Math);
