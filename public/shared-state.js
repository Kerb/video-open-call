window.STATE = {
  HOME: 'home',
  JOIN_MODAL: 'join-modal',
  WAITING: 'waiting',
  CONNECTING: 'connecting',
  IN_CALL: 'in-call',
  DISCONNECTED: 'disconnected',
};

window.STATE_TRANSITIONS = {
  [window.STATE.HOME]: [window.STATE.JOIN_MODAL, window.STATE.WAITING],
  [window.STATE.JOIN_MODAL]: [window.STATE.HOME, window.STATE.WAITING],
  [window.STATE.WAITING]: [window.STATE.CONNECTING, window.STATE.DISCONNECTED, window.STATE.HOME],
  [window.STATE.CONNECTING]: [window.STATE.IN_CALL, window.STATE.DISCONNECTED, window.STATE.HOME],
  [window.STATE.IN_CALL]: [window.STATE.DISCONNECTED, window.STATE.HOME],
  [window.STATE.DISCONNECTED]: [window.STATE.CONNECTING, window.STATE.HOME],
};
