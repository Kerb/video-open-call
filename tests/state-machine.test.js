import { describe, it, expect } from 'vitest';
import { STATE, STATE_TRANSITIONS, createStateMachine } from '../src/state-machine.js';

describe('STATE_TRANSITIONS', () => {
  it('should define transitions for all states', () => {
    for (const s of Object.values(STATE)) {
      expect(STATE_TRANSITIONS[s]).toBeDefined();
      expect(Array.isArray(STATE_TRANSITIONS[s])).toBe(true);
    }
  });

  it('should only allow valid transitions', () => {
    expect(STATE_TRANSITIONS[STATE.HOME]).toContain(STATE.JOIN_MODAL);
    expect(STATE_TRANSITIONS[STATE.HOME]).toContain(STATE.WAITING);
    expect(STATE_TRANSITIONS[STATE.HOME]).not.toContain(STATE.IN_CALL);

    expect(STATE_TRANSITIONS[STATE.WAITING]).toContain(STATE.CONNECTING);
    expect(STATE_TRANSITIONS[STATE.WAITING]).toContain(STATE.HOME);
    expect(STATE_TRANSITIONS[STATE.WAITING]).not.toContain(STATE.JOIN_MODAL);

    expect(STATE_TRANSITIONS[STATE.CONNECTING]).toContain(STATE.IN_CALL);
    expect(STATE_TRANSITIONS[STATE.CONNECTING]).toContain(STATE.HOME);
    expect(STATE_TRANSITIONS[STATE.CONNECTING]).not.toContain(STATE.WAITING);

    expect(STATE_TRANSITIONS[STATE.IN_CALL]).toContain(STATE.HOME);
    expect(STATE_TRANSITIONS[STATE.IN_CALL]).not.toContain(STATE.WAITING);
  });

  it('should allow JOIN_MODAL to go back to HOME', () => {
    expect(STATE_TRANSITIONS[STATE.JOIN_MODAL]).toContain(STATE.HOME);
  });

  it('should allow JOIN_MODAL to go to WAITING', () => {
    expect(STATE_TRANSITIONS[STATE.JOIN_MODAL]).toContain(STATE.WAITING);
  });

  it('should allow IN_CALL to go to DISCONNECTED', () => {
    expect(STATE_TRANSITIONS[STATE.IN_CALL]).toContain(STATE.DISCONNECTED);
  });

  it('should allow DISCONNECTED to go to CONNECTING', () => {
    expect(STATE_TRANSITIONS[STATE.DISCONNECTED]).toContain(STATE.CONNECTING);
  });

  it('should allow DISCONNECTED to go to HOME', () => {
    expect(STATE_TRANSITIONS[STATE.DISCONNECTED]).toContain(STATE.HOME);
  });

  it('should not allow DISCONNECTED to go to WAITING', () => {
    expect(STATE_TRANSITIONS[STATE.DISCONNECTED]).not.toContain(STATE.WAITING);
  });
});

describe('createStateMachine', () => {
  it('should start in HOME by default', () => {
    const sm = createStateMachine();
    expect(sm.getState()).toBe(STATE.HOME);
  });

  it('should start in the given initial state', () => {
    const sm = createStateMachine(STATE.WAITING);
    expect(sm.getState()).toBe(STATE.WAITING);
  });

  it('should transition to a valid state', () => {
    const sm = createStateMachine();
    expect(sm.transition(STATE.WAITING)).toBe(true);
    expect(sm.getState()).toBe(STATE.WAITING);
  });

  it('should reject invalid transitions', () => {
    const sm = createStateMachine();
    expect(sm.transition(STATE.IN_CALL)).toBe(false);
    expect(sm.getState()).toBe(STATE.HOME);
  });

  it('should follow the full happy path', () => {
    const sm = createStateMachine();
    expect(sm.getState()).toBe(STATE.HOME);

    sm.transition(STATE.WAITING);
    expect(sm.getState()).toBe(STATE.WAITING);

    sm.transition(STATE.CONNECTING);
    expect(sm.getState()).toBe(STATE.CONNECTING);

    sm.transition(STATE.IN_CALL);
    expect(sm.getState()).toBe(STATE.IN_CALL);

    sm.transition(STATE.HOME);
    expect(sm.getState()).toBe(STATE.HOME);
  });

  it('should follow the join-modal path', () => {
    const sm = createStateMachine();
    sm.transition(STATE.JOIN_MODAL);
    expect(sm.getState()).toBe(STATE.JOIN_MODAL);

    sm.transition(STATE.WAITING);
    expect(sm.getState()).toBe(STATE.WAITING);
  });

  it('should handle cancel from join modal', () => {
    const sm = createStateMachine();
    sm.transition(STATE.JOIN_MODAL);
    sm.transition(STATE.HOME);
    expect(sm.getState()).toBe(STATE.HOME);
  });

  it('should allow hangup from any non-home state', () => {
    const states = [STATE.WAITING, STATE.CONNECTING, STATE.IN_CALL, STATE.DISCONNECTED];
    for (const s of states) {
      const sm = createStateMachine(s);
      expect(sm.transition(STATE.HOME)).toBe(true);
    }
  });

  it('canTransition should work correctly', () => {
    const sm = createStateMachine(STATE.HOME);
    expect(sm.canTransition(STATE.WAITING)).toBe(true);
    expect(sm.canTransition(STATE.IN_CALL)).toBe(false);
  });

  it('canTransition should work for DISCONNECTED', () => {
    const sm = createStateMachine(STATE.DISCONNECTED);
    expect(sm.canTransition(STATE.CONNECTING)).toBe(true);
    expect(sm.canTransition(STATE.HOME)).toBe(true);
    expect(sm.canTransition(STATE.WAITING)).toBe(false);
  });

  it('should handle DISCONNECTED flow in both directions', () => {
    const sm = createStateMachine(STATE.IN_CALL);
    expect(sm.transition(STATE.DISCONNECTED)).toBe(true);
    expect(sm.getState()).toBe(STATE.DISCONNECTED);

    expect(sm.transition(STATE.CONNECTING)).toBe(true);
    expect(sm.getState()).toBe(STATE.CONNECTING);
  });

  it('should allow leaving from DISCONNECTED to HOME', () => {
    const sm = createStateMachine(STATE.DISCONNECTED);
    expect(sm.transition(STATE.HOME)).toBe(true);
    expect(sm.getState()).toBe(STATE.HOME);
  });
});
