import { describe, test, expect } from 'vitest';
import { STATE, STATE_TRANSITIONS } from '../src/shared-state.js';
import * as serverState from '../src/state-machine.js';

describe('State Consistency', () => {
  test('server uses shared state module', () => {
    expect(serverState.STATE).toStrictEqual(STATE);
    expect(serverState.STATE_TRANSITIONS).toStrictEqual(STATE_TRANSITIONS);
  });

  test('shared state module exports expected properties', () => {
    expect(STATE).toBeDefined();
    expect(STATE_TRANSITIONS).toBeDefined();
    expect(typeof STATE).toBe('object');
    expect(typeof STATE_TRANSITIONS).toBe('object');
  });

  test('shared state defines all expected states', () => {
    expect(STATE.HOME).toBe('home');
    expect(STATE.JOIN_MODAL).toBe('join-modal');
    expect(STATE.WAITING).toBe('waiting');
    expect(STATE.CONNECTING).toBe('connecting');
    expect(STATE.IN_CALL).toBe('in-call');
    expect(STATE.DISCONNECTED).toBe('disconnected');
  });
});