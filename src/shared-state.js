const STATE = {
  HOME: 'home',
  JOIN_MODAL: 'join-modal',
  WAITING: 'waiting',
  CONNECTING: 'connecting',
  IN_CALL: 'in-call',
  DISCONNECTED: 'disconnected',
};

const STATE_TRANSITIONS = {
  [STATE.HOME]: [STATE.JOIN_MODAL, STATE.WAITING],
  [STATE.JOIN_MODAL]: [STATE.HOME, STATE.WAITING],
  [STATE.WAITING]: [STATE.CONNECTING, STATE.DISCONNECTED, STATE.HOME],
  [STATE.CONNECTING]: [STATE.IN_CALL, STATE.DISCONNECTED, STATE.HOME],
  [STATE.IN_CALL]: [STATE.DISCONNECTED, STATE.HOME],
  [STATE.DISCONNECTED]: [STATE.CONNECTING, STATE.HOME],
};

function createStateMachine(initialState) {
  let currentState = initialState || STATE.HOME;

  function getState() {
    return currentState;
  }

  function transition(newState) {
    const allowed = STATE_TRANSITIONS[currentState];
    if (!allowed || !allowed.includes(newState)) {
      return false;
    }
    currentState = newState;
    return true;
  }

  function canTransition(newState) {
    const allowed = STATE_TRANSITIONS[currentState];
    return allowed && allowed.includes(newState);
  }

  return { getState, transition, canTransition };
}

module.exports = {
  STATE,
  STATE_TRANSITIONS,
  createStateMachine
};