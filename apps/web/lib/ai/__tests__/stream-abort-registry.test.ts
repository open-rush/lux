import { beforeEach, describe, expect, it } from 'vitest';
import {
  abortStream,
  registerAbortController,
  unregisterAbortController,
} from '../stream-abort-registry';

// The registry is a module-level singleton Map. We clean up known keys before
// each test to avoid cross-test interference.
const TEST_PROJECT_A = 'project-a';
const TEST_PROJECT_B = 'project-b';

beforeEach(() => {
  // Ensure a clean slate by aborting any leftover entries from previous tests.
  abortStream(TEST_PROJECT_A);
  abortStream(TEST_PROJECT_B);
});

// ---------------------------------------------------------------------------
// registerAbortController
// ---------------------------------------------------------------------------
describe('registerAbortController', () => {
  it('stores a controller that can later be aborted', () => {
    const controller = new AbortController();
    registerAbortController(TEST_PROJECT_A, controller);

    // If the controller is registered, abortStream should find it and return true.
    expect(abortStream(TEST_PROJECT_A)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// unregisterAbortController
// ---------------------------------------------------------------------------
describe('unregisterAbortController', () => {
  it('removes the controller when the same instance is passed', () => {
    const controller = new AbortController();
    registerAbortController(TEST_PROJECT_A, controller);
    unregisterAbortController(TEST_PROJECT_A, controller);

    // After unregistering, abortStream should not find it.
    expect(abortStream(TEST_PROJECT_A)).toBe(false);
    // The controller itself should NOT have been aborted by unregister.
    expect(controller.signal.aborted).toBe(false);
  });

  it('does NOT remove the controller when a different instance is passed', () => {
    const original = new AbortController();
    const imposter = new AbortController();
    registerAbortController(TEST_PROJECT_A, original);

    unregisterAbortController(TEST_PROJECT_A, imposter);

    // The original should still be in the registry.
    expect(abortStream(TEST_PROJECT_A)).toBe(true);
    expect(original.signal.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// abortStream
// ---------------------------------------------------------------------------
describe('abortStream', () => {
  it('calls abort(), removes the controller, and returns true', () => {
    const controller = new AbortController();
    registerAbortController(TEST_PROJECT_A, controller);

    expect(abortStream(TEST_PROJECT_A)).toBe(true);
    expect(controller.signal.aborted).toBe(true);

    // A second call should return false because the entry was removed.
    expect(abortStream(TEST_PROJECT_A)).toBe(false);
  });

  it('returns false when no controller is registered for the projectId', () => {
    expect(abortStream('non-existent-project')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple projectIds
// ---------------------------------------------------------------------------
describe('multiple projectIds', () => {
  it('tracks controllers independently per projectId', () => {
    const controllerA = new AbortController();
    const controllerB = new AbortController();

    registerAbortController(TEST_PROJECT_A, controllerA);
    registerAbortController(TEST_PROJECT_B, controllerB);

    // Abort only A.
    expect(abortStream(TEST_PROJECT_A)).toBe(true);
    expect(controllerA.signal.aborted).toBe(true);

    // B should still be registered and not aborted.
    expect(controllerB.signal.aborted).toBe(false);
    expect(abortStream(TEST_PROJECT_B)).toBe(true);
    expect(controllerB.signal.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Re-registration after abort
// ---------------------------------------------------------------------------
describe('register → abort → register again', () => {
  it('allows a fresh controller after the previous one was aborted', () => {
    const first = new AbortController();
    registerAbortController(TEST_PROJECT_A, first);
    abortStream(TEST_PROJECT_A);

    const second = new AbortController();
    registerAbortController(TEST_PROJECT_A, second);

    expect(second.signal.aborted).toBe(false);
    expect(abortStream(TEST_PROJECT_A)).toBe(true);
    expect(second.signal.aborted).toBe(true);
  });
});
