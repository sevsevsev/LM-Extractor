import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  PDF_WORKER_POLYFILL_SOURCE,
  installGetOrInsertComputedPolyfill,
  installSumPrecisePolyfill,
} from './polyfills';

/**
 * The bug these guard against was not that the polyfills were wrong — they were correct, and had
 * been since they were written. It was that they only ever ran in one realm, so pdf.js's Web Worker
 * never saw them. A fresh `vm` context is the closest thing Node has to that second realm: its own
 * `Map`, `WeakMap` and `Math`, exactly as a module worker has. See `polyfills.ts`.
 */

/** A realm with both methods removed, standing in for a browser that has not shipped them. */
function realmWithoutTheMethods(): vm.Context {
  const context = vm.createContext({});
  vm.runInContext(
    `delete Map.prototype.getOrInsertComputed;
     delete WeakMap.prototype.getOrInsertComputed;
     delete Math.sumPrecise;`,
    context
  );
  return context;
}

/** Exercises what pdf.js actually asks of the two methods. */
const BEHAVIOUR_PROBE = `(() => {
  const m = new Map();
  let calls = 0;
  const first = m.getOrInsertComputed('k', () => { calls++; return [1]; });
  const second = m.getOrInsertComputed('k', () => { calls++; return [2]; });

  const wm = new WeakMap();
  const key = {};
  wm.getOrInsertComputed(key, () => 7);

  return {
    computedOnce: calls,
    sameReference: first === second,
    value: second[0],
    weakMapValue: wm.getOrInsertComputed(key, () => 9),
    sumInts: Math.sumPrecise([4, 8, 12]),
    sumFractions: Math.sumPrecise([0.1, 0.2]),
    sumCompensated: Math.sumPrecise([1e20, 0.1, -1e20]),
    sumEmpty: Math.sumPrecise([]),
  };
})()`;

/** Cross-realm results carry the vm realm's prototype, so copy into a host object before comparing. */
function probe(context: vm.Context): Record<string, unknown> {
  return { ...(vm.runInContext(BEHAVIOUR_PROBE, context) as Record<string, unknown>) };
}

const EXPECTED = {
  computedOnce: 1,
  sameReference: true,
  value: 1,
  weakMapValue: 7,
  sumInts: 24,
  sumFractions: 0.30000000000000004,
  sumCompensated: 0.1,
  sumEmpty: 0,
};

test('the worker source installs both polyfills into a realm that lacks them', () => {
  const context = realmWithoutTheMethods();
  vm.runInContext(PDF_WORKER_POLYFILL_SOURCE, context);

  assert.equal(vm.runInContext('typeof Map.prototype.getOrInsertComputed', context), 'function');
  assert.equal(vm.runInContext('typeof WeakMap.prototype.getOrInsertComputed', context), 'function');
  assert.equal(vm.runInContext('typeof Math.sumPrecise', context), 'function');
  assert.deepEqual(probe(context), EXPECTED);
});

test('worker source and main-thread installers behave identically', () => {
  // The two copies exist because `fn.toString()` is not safe to ship into a bare worker (see
  // `polyfills.ts`). This is what keeps them from drifting: same probe, same realm shape, same
  // answers. A change to one that is not mirrored in the other fails here.
  const viaSource = realmWithoutTheMethods();
  vm.runInContext(PDF_WORKER_POLYFILL_SOURCE, viaSource);

  const viaInstallers = realmWithoutTheMethods();
  const globals = vm.runInContext('({ Map, WeakMap, Math })', viaInstallers) as {
    Map: typeof Map;
    WeakMap: typeof WeakMap;
    Math: Math;
  };
  installGetOrInsertComputedPolyfill(globals.Map);
  installGetOrInsertComputedPolyfill(globals.WeakMap);
  installSumPrecisePolyfill(globals.Math);

  assert.deepEqual(probe(viaInstallers), probe(viaSource));
  assert.deepEqual(probe(viaInstallers), EXPECTED);
});

test('both copies no-op when the engine already has the real methods', () => {
  const context = vm.createContext({});
  vm.runInContext(
    `Map.prototype.getOrInsertComputed = function () { return 'native'; };
     WeakMap.prototype.getOrInsertComputed = function () { return 'native'; };
     Math.sumPrecise = function () { return 'native'; };`,
    context
  );
  vm.runInContext(PDF_WORKER_POLYFILL_SOURCE, context);

  assert.equal(vm.runInContext('new Map().getOrInsertComputed("k", () => 1)', context), 'native');
  assert.equal(vm.runInContext('new WeakMap().getOrInsertComputed({}, () => 1)', context), 'native');
  assert.equal(vm.runInContext('Math.sumPrecise([1, 2])', context), 'native');
});

test('the worker source runs standalone, with no bundler helpers in scope', () => {
  // esbuild's `keepNames` wraps function bodies in a `__name(...)` call that exists in the bundle
  // and not in a worker, which is why this source is written out rather than stringified from the
  // installers. An empty context has no helpers at all, so anything smuggled in throws here.
  assert.doesNotThrow(() => vm.runInContext(PDF_WORKER_POLYFILL_SOURCE, vm.createContext({})));
  assert.ok(!PDF_WORKER_POLYFILL_SOURCE.includes('__name'));
});
