import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acquireConverter,
  discardConverter,
  withDeadline,
  ConversionTimeoutError,
  type ConverterSlot,
} from './libreOfficeConverter.ts';

interface FakeConverter {
  id: number;
  ready: boolean;
  destroyed: boolean;
  isReady(): boolean;
  destroy(): Promise<void>;
}

function fakeConverters() {
  let made = 0;
  const all: FakeConverter[] = [];
  const create = async (): Promise<FakeConverter> => {
    const c: FakeConverter = {
      id: ++made,
      ready: true,
      destroyed: false,
      isReady() {
        return this.ready;
      },
      async destroy() {
        this.destroyed = true;
        this.ready = false;
      },
    };
    all.push(c);
    return c;
  };
  return { create, all, count: () => made };
}

const emptySlot = (): ConverterSlot<FakeConverter> => ({ instance: null, pending: null });

test('a converter that is still ready is reused rather than restarted', async () => {
  const slot = emptySlot();
  const { create, count } = fakeConverters();
  const first = await acquireConverter(slot, create);
  const second = await acquireConverter(slot, create);
  assert.equal(first, second);
  assert.equal(count(), 1, 'starting LibreOffice twice costs a second of CPU and ~900MB');
});

/**
 * The defect this file exists for. The package's worker `error` handler rejects the calls that
 * were in flight but leaves the instance in place, so `isReady()` goes false while the cached init
 * promise still resolves to that instance. Before this fix the stale promise won: every later
 * conversion in the process threw "Converter not initialized. Call initialize() first.", so a
 * single lost worker broke one warm serverless instance for the rest of its life while requests
 * routed elsewhere succeeded — a deck that fails inside a batch and converts on its own.
 */
test('a converter that has stopped being ready is replaced, not handed back', async () => {
  const slot = emptySlot();
  const { create, all, count } = fakeConverters();
  const first = await acquireConverter(slot, create);

  first.ready = false; // the worker died

  const second = await acquireConverter(slot, create);
  assert.notEqual(second, first);
  assert.equal(second.isReady(), true);
  assert.equal(count(), 2);
  assert.equal(all[0].destroyed, true, 'the dead one is terminated, not left holding memory');
});

test('a failed start is not cached, so the next caller tries again', async () => {
  const slot = emptySlot();
  let attempts = 0;
  const create = async () => {
    attempts++;
    if (attempts === 1) throw new Error('wasm missing');
    return {
      isReady: () => true,
      destroy: async () => {},
    };
  };
  await assert.rejects(() => acquireConverter(slot, create), /wasm missing/);
  const recovered = await acquireConverter(slot, create);
  assert.equal(recovered.isReady(), true);
  assert.equal(attempts, 2);
});

test('concurrent callers share one start', async () => {
  const slot = emptySlot();
  const { create, count } = fakeConverters();
  const [a, b, c] = await Promise.all([
    acquireConverter(slot, create),
    acquireConverter(slot, create),
    acquireConverter(slot, create),
  ]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(count(), 1);
});

test('discarding empties the slot so the next call starts fresh', async () => {
  const slot = emptySlot();
  const { create, count } = fakeConverters();
  await acquireConverter(slot, create);
  discardConverter(slot);
  assert.equal(slot.instance, null);
  assert.equal(slot.pending, null);
  await acquireConverter(slot, create);
  assert.equal(count(), 2);
});

test('withDeadline returns the result when the work finishes in time', async () => {
  let timedOut = false;
  const value = await withDeadline(Promise.resolve('pdf'), 1000, () => {
    timedOut = true;
  });
  assert.equal(value, 'pdf');
  assert.equal(timedOut, false);
});

/**
 * Measured 2026-09-26: roughly one cold first conversion in three stalls for about 80 seconds on a
 * deck that otherwise converts in two, and the stall is idle waiting, not work. The convert
 * function's own limit is 60s and cannot be raised on a personal account, so past that the
 * platform kills the invocation and answers with an HTML gateway page the browser cannot explain.
 * Stopping first is what lets the route say a real sentence and lets the retry start clean.
 */
test('withDeadline gives up, says so, and lets the caller drop the stuck converter', async () => {
  let discarded = 0;
  // Settles long after the deadline: a conversion that never settles at all would keep this
  // test's event loop pending, which is the one thing a stalled worker does not do to production.
  let release: (value: string) => void = () => {};
  const stuck = new Promise<string>(resolve => {
    release = resolve;
  });
  await assert.rejects(
    () => withDeadline(stuck, 10, () => discarded++),
    (error: unknown) => {
      assert.ok(error instanceof ConversionTimeoutError);
      assert.match((error as Error).message, /did not finish converting within/);
      return true;
    }
  );
  assert.equal(discarded, 1);
  release('arrived far too late');
  await stuck;
});

test('a conversion that fails after the deadline does not become an unhandled rejection', async () => {
  const late = new Promise<string>((_, reject) => setTimeout(() => reject(new Error('too late')), 5));
  await assert.rejects(() => withDeadline(late, 1, () => {}), ConversionTimeoutError);
  await new Promise(resolve => setTimeout(resolve, 20));
});
