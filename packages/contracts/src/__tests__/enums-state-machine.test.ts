import { describe, expect, it } from 'vitest';
import {
  isValidRunTransition,
  RunStatus,
  TERMINAL_RUN_STATUSES,
  VALID_RUN_TRANSITIONS,
} from '../enums.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_STATUSES: readonly RunStatus[] = RunStatus.options;

/** Walk the happy path and assert every consecutive pair is a valid transition. */
function assertPathIsValid(path: readonly RunStatus[]) {
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    expect(
      isValidRunTransition(from, to),
      `Expected transition ${from} -> ${to} to be valid (step ${i + 1})`
    ).toBe(true);
  }
}

/** BFS from `start`, returning the set of all reachable statuses. */
function reachableFrom(start: RunStatus): Set<RunStatus> {
  const visited = new Set<RunStatus>();
  const queue: RunStatus[] = [start];
  visited.add(start);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const next of VALID_RUN_TRANSITIONS[current]) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

// ---------------------------------------------------------------------------
// 1. Happy path walkthrough
// ---------------------------------------------------------------------------

describe('Happy path walkthrough', () => {
  const HAPPY_PATH: readonly RunStatus[] = [
    'queued',
    'provisioning',
    'preparing',
    'running',
    'finalizing_prepare',
    'finalizing_uploading',
    'finalizing_verifying',
    'finalizing_metadata_commit',
    'finalized',
    'completed',
  ];

  it('every consecutive step in the happy path is a valid transition', () => {
    assertPathIsValid(HAPPY_PATH);
  });

  it('happy path starts at queued and ends at completed', () => {
    expect(HAPPY_PATH[0]).toBe('queued');
    expect(HAPPY_PATH[HAPPY_PATH.length - 1]).toBe('completed');
  });

  it('happy path has exactly 10 states', () => {
    expect(HAPPY_PATH).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// 2. Failure from every non-terminal state that can fail
// ---------------------------------------------------------------------------

describe('Failure transitions', () => {
  // States that CAN transition to failed
  const STATES_THAT_CAN_FAIL: readonly RunStatus[] = [
    'queued',
    'provisioning',
    'preparing',
    'running',
    'finalizing_prepare',
    'finalizing_uploading',
    'finalizing_verifying',
    'finalizing_metadata_commit',
    'worker_unreachable',
    'finalizing_manual_intervention',
  ];

  // States that CANNOT transition to failed
  const STATES_THAT_CANNOT_FAIL: readonly RunStatus[] = [
    'completed',
    'finalized',
    'failed',
    'finalizing_retryable_failed',
    'finalizing_timeout',
  ];

  for (const status of STATES_THAT_CAN_FAIL) {
    it(`${status} -> failed is valid`, () => {
      expect(isValidRunTransition(status, 'failed')).toBe(true);
    });
  }

  for (const status of STATES_THAT_CANNOT_FAIL) {
    it(`${status} -> failed is NOT valid`, () => {
      expect(isValidRunTransition(status, 'failed')).toBe(false);
    });
  }

  it('every status is accounted for in can-fail or cannot-fail lists', () => {
    const accounted = new Set([...STATES_THAT_CAN_FAIL, ...STATES_THAT_CANNOT_FAIL]);
    for (const status of ALL_STATUSES) {
      expect(
        accounted.has(status),
        `Status "${status}" not classified in failure transition lists`
      ).toBe(true);
    }
    expect(accounted.size).toBe(ALL_STATUSES.length);
  });
});

// ---------------------------------------------------------------------------
// 3. Retry cycle: failed -> queued -> ... -> completed
// ---------------------------------------------------------------------------

describe('Retry cycle', () => {
  it('failed -> queued is valid (retry entry point)', () => {
    expect(isValidRunTransition('failed', 'queued')).toBe(true);
  });

  it('full retry path: failed -> queued -> ... -> completed', () => {
    const retryPath: readonly RunStatus[] = [
      'failed',
      'queued',
      'provisioning',
      'preparing',
      'running',
      'finalizing_prepare',
      'finalizing_uploading',
      'finalizing_verifying',
      'finalizing_metadata_commit',
      'finalized',
      'completed',
    ];
    assertPathIsValid(retryPath);
  });

  it('failed cannot skip to provisioning directly', () => {
    expect(isValidRunTransition('failed', 'provisioning')).toBe(false);
  });

  it('failed cannot go to completed directly', () => {
    expect(isValidRunTransition('failed', 'completed')).toBe(false);
  });

  it('failed can only go to queued', () => {
    expect(VALID_RUN_TRANSITIONS.failed).toEqual(['queued']);
  });
});

// ---------------------------------------------------------------------------
// 4. Worker unreachable paths
// ---------------------------------------------------------------------------

describe('Worker unreachable paths', () => {
  it('running -> worker_unreachable is valid', () => {
    expect(isValidRunTransition('running', 'worker_unreachable')).toBe(true);
  });

  it('worker_unreachable -> running (recovery)', () => {
    expect(isValidRunTransition('worker_unreachable', 'running')).toBe(true);
  });

  it('worker_unreachable -> failed (give up)', () => {
    expect(isValidRunTransition('worker_unreachable', 'failed')).toBe(true);
  });

  it('worker_unreachable has exactly 2 outgoing transitions', () => {
    expect(VALID_RUN_TRANSITIONS.worker_unreachable).toHaveLength(2);
  });

  it('full recovery path: running -> worker_unreachable -> running -> finalization -> completed', () => {
    const recoveryPath: readonly RunStatus[] = [
      'running',
      'worker_unreachable',
      'running',
      'finalizing_prepare',
      'finalizing_uploading',
      'finalizing_verifying',
      'finalizing_metadata_commit',
      'finalized',
      'completed',
    ];
    assertPathIsValid(recoveryPath);
  });

  it('give-up path: running -> worker_unreachable -> failed -> queued (retry)', () => {
    const giveUpPath: readonly RunStatus[] = ['running', 'worker_unreachable', 'failed', 'queued'];
    assertPathIsValid(giveUpPath);
  });

  it('only running can reach worker_unreachable', () => {
    for (const status of ALL_STATUSES) {
      if (status === 'running') continue;
      expect(
        isValidRunTransition(status, 'worker_unreachable'),
        `${status} -> worker_unreachable should be invalid`
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Finalization retry paths
// ---------------------------------------------------------------------------

describe('Finalization retry paths', () => {
  const FINALIZING_STATES_WITH_RETRY: readonly RunStatus[] = [
    'finalizing_prepare',
    'finalizing_uploading',
    'finalizing_verifying',
    'finalizing_metadata_commit',
  ];

  for (const state of FINALIZING_STATES_WITH_RETRY) {
    it(`${state} -> finalizing_retryable_failed is valid`, () => {
      expect(isValidRunTransition(state, 'finalizing_retryable_failed')).toBe(true);
    });
  }

  it('finalizing_retryable_failed -> finalizing_uploading (retry)', () => {
    expect(isValidRunTransition('finalizing_retryable_failed', 'finalizing_uploading')).toBe(true);
  });

  it('finalizing_retryable_failed -> finalizing_timeout (escalate)', () => {
    expect(isValidRunTransition('finalizing_retryable_failed', 'finalizing_timeout')).toBe(true);
  });

  it('finalizing_retryable_failed has exactly 2 outgoing transitions', () => {
    expect(VALID_RUN_TRANSITIONS.finalizing_retryable_failed).toHaveLength(2);
  });

  it('retry loop: finalizing_uploading -> retryable_failed -> finalizing_uploading', () => {
    const retryLoop: readonly RunStatus[] = [
      'finalizing_uploading',
      'finalizing_retryable_failed',
      'finalizing_uploading',
      'finalizing_verifying',
      'finalizing_metadata_commit',
      'finalized',
      'completed',
    ];
    assertPathIsValid(retryLoop);
  });

  it('escalation path: retryable_failed -> timeout -> manual_intervention -> failed', () => {
    const escalationPath: readonly RunStatus[] = [
      'finalizing_retryable_failed',
      'finalizing_timeout',
      'finalizing_manual_intervention',
      'failed',
    ];
    assertPathIsValid(escalationPath);
  });

  it('full escalation from running: running -> finalization failure -> escalation -> failed', () => {
    const fullEscalation: readonly RunStatus[] = [
      'running',
      'finalizing_prepare',
      'finalizing_uploading',
      'finalizing_retryable_failed',
      'finalizing_timeout',
      'finalizing_manual_intervention',
      'failed',
    ];
    assertPathIsValid(fullEscalation);
  });

  it('finalizing_timeout can only go to finalizing_manual_intervention', () => {
    expect(VALID_RUN_TRANSITIONS.finalizing_timeout).toEqual(['finalizing_manual_intervention']);
  });

  it('finalizing_manual_intervention can only go to failed', () => {
    expect(VALID_RUN_TRANSITIONS.finalizing_manual_intervention).toEqual(['failed']);
  });
});

// ---------------------------------------------------------------------------
// 6. No backward transitions
// ---------------------------------------------------------------------------

describe('No backward transitions', () => {
  const BACKWARD_PAIRS: readonly [RunStatus, RunStatus][] = [
    ['running', 'queued'],
    ['running', 'provisioning'],
    ['running', 'preparing'],
    ['finalized', 'running'],
    ['finalized', 'finalizing_prepare'],
    ['finalized', 'finalizing_uploading'],
    ['finalized', 'finalizing_verifying'],
    ['finalized', 'finalizing_metadata_commit'],
    ['completed', 'queued'],
    ['completed', 'running'],
    ['completed', 'finalized'],
    ['completed', 'failed'],
    ['preparing', 'provisioning'],
    ['preparing', 'queued'],
    ['provisioning', 'queued'],
    ['finalizing_verifying', 'finalizing_uploading'],
    ['finalizing_metadata_commit', 'finalizing_verifying'],
    ['finalizing_metadata_commit', 'finalizing_uploading'],
  ];

  for (const [from, to] of BACKWARD_PAIRS) {
    it(`${from} -> ${to} is not allowed (backward)`, () => {
      expect(isValidRunTransition(from, to)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. No skip-ahead transitions
// ---------------------------------------------------------------------------

describe('No skip-ahead transitions', () => {
  const SKIP_AHEAD_PAIRS: readonly [RunStatus, RunStatus][] = [
    ['queued', 'running'],
    ['queued', 'preparing'],
    ['queued', 'completed'],
    ['queued', 'finalized'],
    ['queued', 'finalizing_prepare'],
    ['provisioning', 'running'],
    ['provisioning', 'completed'],
    ['provisioning', 'finalized'],
    ['preparing', 'finalizing_prepare'],
    ['preparing', 'completed'],
    ['running', 'finalized'],
    ['running', 'completed'],
    ['running', 'finalizing_uploading'],
    ['running', 'finalizing_verifying'],
    ['running', 'finalizing_metadata_commit'],
    ['finalizing_prepare', 'finalized'],
    ['finalizing_prepare', 'completed'],
    ['finalizing_prepare', 'finalizing_verifying'],
    ['finalizing_prepare', 'finalizing_metadata_commit'],
    ['finalizing_uploading', 'finalized'],
    ['finalizing_uploading', 'completed'],
    ['finalizing_uploading', 'finalizing_metadata_commit'],
    ['finalizing_verifying', 'finalized'],
    ['finalizing_verifying', 'completed'],
  ];

  for (const [from, to] of SKIP_AHEAD_PAIRS) {
    it(`${from} -> ${to} is not allowed (skip-ahead)`, () => {
      expect(isValidRunTransition(from, to)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Graph completeness
// ---------------------------------------------------------------------------

describe('Graph completeness', () => {
  it('every RunStatus option has an entry in VALID_RUN_TRANSITIONS', () => {
    const transitionKeys = new Set(Object.keys(VALID_RUN_TRANSITIONS));
    for (const status of ALL_STATUSES) {
      expect(
        transitionKeys.has(status),
        `Status "${status}" missing from VALID_RUN_TRANSITIONS`
      ).toBe(true);
    }
  });

  it('VALID_RUN_TRANSITIONS has no extra keys beyond RunStatus options', () => {
    const statusSet = new Set<string>(ALL_STATUSES);
    for (const key of Object.keys(VALID_RUN_TRANSITIONS)) {
      expect(
        statusSet.has(key),
        `Key "${key}" in VALID_RUN_TRANSITIONS is not a valid RunStatus`
      ).toBe(true);
    }
  });

  it('all transition targets are valid RunStatus values', () => {
    const statusSet = new Set<string>(ALL_STATUSES);
    for (const [from, targets] of Object.entries(VALID_RUN_TRANSITIONS)) {
      for (const to of targets) {
        expect(
          statusSet.has(to),
          `Transition target "${to}" from "${from}" is not a valid RunStatus`
        ).toBe(true);
      }
    }
  });

  it('no duplicate targets in any transition list', () => {
    for (const [from, targets] of Object.entries(VALID_RUN_TRANSITIONS)) {
      const unique = new Set(targets);
      expect(unique.size, `Status "${from}" has duplicate transition targets`).toBe(targets.length);
    }
  });

  it('no self-transitions exist', () => {
    for (const status of ALL_STATUSES) {
      expect(
        isValidRunTransition(status, status),
        `Self-transition ${status} -> ${status} should not exist`
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Graph reachability (BFS from queued)
// ---------------------------------------------------------------------------

describe('Graph reachability', () => {
  it('every status is reachable from queued', () => {
    const reachable = reachableFrom('queued');
    for (const status of ALL_STATUSES) {
      expect(reachable.has(status), `Status "${status}" is not reachable from "queued"`).toBe(true);
    }
  });

  it('completed is reachable from every non-terminal status via some path', () => {
    // Every status except completed itself should be able to eventually reach completed
    for (const status of ALL_STATUSES) {
      if (status === 'completed') continue;
      const reachable = reachableFrom(status);
      expect(reachable.has('completed'), `"completed" is not reachable from "${status}"`).toBe(
        true
      );
    }
  });

  it('failed is reachable from queued', () => {
    const reachable = reachableFrom('queued');
    expect(reachable.has('failed')).toBe(true);
  });

  it('queued is reachable from failed (retry cycle creates a loop)', () => {
    const reachable = reachableFrom('failed');
    expect(reachable.has('queued')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Terminal states
// ---------------------------------------------------------------------------

describe('Terminal states', () => {
  it('completed is the only status with zero outgoing transitions', () => {
    const terminalStatuses = ALL_STATUSES.filter((s) => VALID_RUN_TRANSITIONS[s].length === 0);
    expect(terminalStatuses).toEqual(['completed']);
  });

  it('TERMINAL_RUN_STATUSES matches the computed terminal states', () => {
    const computed = ALL_STATUSES.filter((s) => VALID_RUN_TRANSITIONS[s].length === 0);
    expect([...TERMINAL_RUN_STATUSES]).toEqual(computed);
  });

  it('every non-terminal status has at least one outgoing transition', () => {
    for (const status of ALL_STATUSES) {
      if (TERMINAL_RUN_STATUSES.includes(status)) continue;
      expect(
        VALID_RUN_TRANSITIONS[status].length,
        `Non-terminal status "${status}" should have outgoing transitions`
      ).toBeGreaterThan(0);
    }
  });

  it('completed cannot transition to any status', () => {
    for (const target of ALL_STATUSES) {
      expect(isValidRunTransition('completed', target)).toBe(false);
    }
  });
});
