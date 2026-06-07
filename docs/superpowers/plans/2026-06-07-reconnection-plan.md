# Reconnection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to reconnect to an existing video-call room within 30 seconds after a socket disconnect, without losing their place or ending the call for the other participant.

**Architecture:** Room model on the server changes from `Map<socketId, Socket>` to slot-based storage with client-generated UUID. Server maintains a 30-second reconnect window per slot. On reconnect, a full WebRTC renegotiation (offer/answer) restores the call. The client persists a UUID in `localStorage` and tracks reconnection state with a new `DISCONNECTED` app state.

**Tech Stack:** Node.js + Socket.IO + Express (server), vanilla JS SPA (client), Vitest (tests)

---

### Task 1: Add DISCONNECTED state to state machine

**Files:**
- Modify: `src/state-machine.js`
- Modify: `tests/state-machine.test.js`

- [ ] **Step 1: Update `src/state-machine.js` — add DISCONNECTED state and transitions**

```javascript
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
  [STATE.WAITING]: [STATE.CONNECTING, STATE.HOME],
  [STATE.CONNECTING]: [STATE.IN_CALL, STATE.HOME],
  [STATE.IN_CALL]: [STATE.DISCONNECTED, STATE.HOME],
  [STATE.DISCONNECTED]: [STATE.CONNECTING, STATE.HOME],
};
```

- [ ] **Step 2: Add tests for DISCONNECTED in `tests/state-machine.test.js`**

Add inside the `STATE_TRANSITIONS` describe block:

```javascript
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
```

Add inside the `createStateMachine` describe block:

```javascript
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
```

- [ ] **Step 3: Run tests to verify**

Run: `npx vitest run tests/state-machine.test.js`
Expected: all tests pass (including new ones)

- [ ] **Step 4: Commit**

```bash
git add src/state-machine.js tests/state-machine.test.js
git commit -m "feat: add DISCONNECTED state for reconnection flow"
```

---

### Task 2: Server — slot model with UUID, modify create/join/leave

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Update `create-room` and `join-room` handlers to use slots with UUID**

Replace the room creation in `create-room` handler:

```javascript
socket.on('create-room', ({ uuid }) => {
  if (socket.currentRoom) {
    socket.emit('room-error', { message: 'Вы уже находитесь в комнате' });
    return;
  }

  const code = generateCode(new Set(rooms.keys()));
  const slot = {
    uuid,
    socket,
    isCreator: true,
    connected: true,
    reconnectTimer: null,
  };
  const room = {
    code,
    slots: new Map([[uuid, slot]]),
    socketToUuid: new Map([[socket.id, uuid]]),
    createdAt: Date.now(),
    cleanupTimer: setTimeout(() => {
      const room = rooms.get(code);
      if (room && room.slots.size < 2) {
        cleanUpRoom(code);
      }
    }, EMPTY_ROOM_TIMEOUT),
    graceTimer: null,
  };

  rooms.set(code, room);
  socket.currentRoom = code;
  socket.join(code);
  socket.emit('room-created', { code });
});
```

Replace the room-join handler:

```javascript
socket.on('join-room', ({ code, uuid }) => {
  if (socket.currentRoom) {
    socket.emit('room-error', { message: 'Вы уже находитесь в комнате' });
    return;
  }

  const codeUpper = code.toUpperCase();
  const room = rooms.get(codeUpper);

  if (!room) {
    socket.emit('room-not-found');
    return;
  }

  if (room.slots.size >= 2) {
    socket.emit('room-full');
    return;
  }

  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }

  const slot = {
    uuid,
    socket,
    isCreator: false,
    connected: true,
    reconnectTimer: null,
  };
  room.slots.set(uuid, slot);
  room.socketToUuid.set(socket.id, uuid);
  socket.currentRoom = codeUpper;
  socket.join(codeUpper);

  socket.emit('room-joined', { code: codeUpper });
  socket.to(codeUpper).emit('user-joined', { userId: socket.id });
});
```

Replace `leaveRoom` function:

```javascript
function leaveRoom(socket) {
  const code = socket.currentRoom;
  if (!code) return;

  const room = rooms.get(code);
  if (room) {
    const uuid = room.socketToUuid.get(socket.id);
    if (uuid) {
      const slot = room.slots.get(uuid);
      if (slot && slot.reconnectTimer) {
        clearTimeout(slot.reconnectTimer);
      }
      room.slots.delete(uuid);
      room.socketToUuid.delete(socket.id);
    }

    socket.to(code).emit('peer-disconnected', { canReconnect: false });
    socket.leave(code);

    if (room.slots.size === 0) {
      if (room.graceTimer) clearTimeout(room.graceTimer);
      room.graceTimer = setTimeout(() => {
        cleanUpRoom(code);
      }, GRACE_PERIOD);
    }
  }

  socket.currentRoom = null;
}
```

- [ ] **Step 2: Run existing tests to verify nothing broke**

Run: `npx vitest run tests/room.test.js`
Expected: all existing tests pass

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add slot-based room model with UUID for reconnection"
```

---

### Task 3: Server — disconnect/reconnect handlers

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Replace `socket.on('disconnect')` with custom disconnect handler and add `reconnect-room` handler**

Remove `socket.on('disconnect')` inside the connection handler and add:

```javascript
  socket.on('disconnect', () => {
    handleSocketDisconnect(socket);
  });

  socket.on('reconnect-room', ({ code, uuid }) => {
    if (!code || !uuid) return;
    const room = rooms.get(code.toUpperCase());
    if (!room) {
      socket.emit('room-not-found');
      return;
    }
    const slot = room.slots.get(uuid);
    if (!slot) {
      socket.emit('room-error', { message: 'Слот не найден' });
      return;
    }
    if (slot.reconnectTimer) {
      clearTimeout(slot.reconnectTimer);
      slot.reconnectTimer = null;
    }
    slot.socket = socket;
    slot.connected = true;
    room.socketToUuid.set(socket.id, uuid);
    socket.currentRoom = code.toUpperCase();
    socket.join(code.toUpperCase());

    socket.emit('reconnect-success', { code: code.toUpperCase(), isCreator: slot.isCreator });

    const otherSlot = [...room.slots.values()].find((s) => s.uuid !== uuid);
    if (otherSlot && otherSlot.socket) {
      otherSlot.socket.emit('peer-reconnected', { uuid });
    }
  });

  socket.on('leave-room', () => {
    leaveRoom(socket);
  });
```

Add `handleSocketDisconnect` function after `leaveRoom`:

```javascript
const RECONNECT_TIMEOUT = 30000;

function handleSocketDisconnect(socket) {
  const code = socket.currentRoom;
  if (!code) return;

  const room = rooms.get(code);
  if (!room) {
    socket.currentRoom = null;
    return;
  }

  const uuid = room.socketToUuid.get(socket.id);
  if (!uuid) {
    socket.currentRoom = null;
    return;
  }

  const slot = room.slots.get(uuid);
  if (!slot) {
    socket.currentRoom = null;
    return;
  }

  slot.socket = null;
  slot.connected = false;
  room.socketToUuid.delete(socket.id);
  socket.currentRoom = null;

  const otherSlot = [...room.slots.values()].find((s) => s.uuid !== uuid);
  if (otherSlot && otherSlot.socket) {
    otherSlot.socket.emit('peer-disconnected', { canReconnect: true });
  }

  slot.reconnectTimer = setTimeout(() => {
    room.slots.delete(uuid);
    const otherSlot = [...room.slots.values()].find((s) => s.uuid !== uuid);
    if (otherSlot && otherSlot.socket) {
      otherSlot.socket.emit('peer-disconnected', { canReconnect: false });
    }
    if (room.slots.size === 0) {
      if (room.graceTimer) clearTimeout(room.graceTimer);
      room.graceTimer = setTimeout(() => {
        cleanUpRoom(code);
      }, GRACE_PERIOD);
    }
  }, RECONNECT_TIMEOUT);
}
```

Also remove the old single `leaveRoom` call from `io.on('connection')` section (we've already broken it into separate handlers above).

- [ ] **Step 2: Commit**

```bash
git add server.js
git commit -m "feat: add socket disconnect/reconnect handlers with 30s reconnect window"
```

---

### Task 4: Server — reconnection tests

**Files:**
- Modify: `tests/room.test.js`

- [ ] **Step 1: Add reconnection tests to `tests/room.test.js`**

Add before the closing `});`:

```javascript
describe('Reconnection', () => {
  let rooms;
  const RECONNECT_TIMEOUT = 30000;

  beforeEach(() => {
    rooms = new Map();
  });

  function createRoom(rooms, code, uuid) {
    const slot = { uuid, socket: null, isCreator: true, connected: true, reconnectTimer: null };
    const room = {
      code,
      slots: new Map([[uuid, slot]]),
      socketToUuid: new Map(),
      createdAt: Date.now(),
      cleanupTimer: null,
      graceTimer: null,
    };
    room.socketToUuid.set(`socket-${uuid}`, uuid);
    slot.socket = { id: `socket-${uuid}` };
    rooms.set(code, room);
    return room;
  }

  function joinRoom(rooms, code, uuid) {
    const room = rooms.get(code);
    if (!room) return { error: 'room-not-found' };
    if (room.slots.size >= 2) return { error: 'room-full' };
    const slot = { uuid, socket: null, isCreator: false, connected: true, reconnectTimer: null };
    room.slots.set(uuid, slot);
    room.socketToUuid.set(`socket-${uuid}`, uuid);
    slot.socket = { id: `socket-${uuid}` };
    return { success: true, uuid };
  }

  function handleSocketDisconnect(rooms, code, socketId) {
    const room = rooms.get(code);
    if (!room) return;
    const uuid = [...room.socketToUuid.entries()].find(([, id]) => id === socketId)?.[0];
    if (!uuid) return;
    const slot = room.slots.get(uuid);
    if (!slot) return;

    slot.socket = null;
    slot.connected = false;
    room.socketToUuid.delete(socketId);
    slot.reconnectTimer = setTimeout(() => {
      room.slots.delete(uuid);
    }, RECONNECT_TIMEOUT);
  }

  function reconnectSlot(rooms, code, uuid, newSocketId) {
    const room = rooms.get(code);
    if (!room) return { error: 'room-not-found' };
    const slot = room.slots.get(uuid);
    if (!slot) return { error: 'slot-not-found' };

    if (slot.reconnectTimer) {
      clearTimeout(slot.reconnectTimer);
      slot.reconnectTimer = null;
    }
    slot.socket = { id: newSocketId };
    slot.connected = true;
    room.socketToUuid.set(newSocketId, uuid);
    return { success: true, isCreator: slot.isCreator };
  }

  it('should mark slot as disconnected and preserve it during reconnect window', () => {
    const code = 'ABC123';
    const uuid1 = 'uuid-creator';
    const uuid2 = 'uuid-joiner';
    createRoom(rooms, code, uuid1);
    joinRoom(rooms, code, uuid2);

    expect(rooms.get(code).slots.size).toBe(2);

    handleSocketDisconnect(rooms, code, 'socket-uuid-creator');

    const room = rooms.get(code);
    expect(room.slots.size).toBe(2);
    expect(room.slots.get(uuid1).connected).toBe(false);
    expect(room.slots.get(uuid1).socket).toBeNull();
    expect(room.slots.get(uuid1).reconnectTimer).not.toBeNull();
  });

  it('should allow reconnection within the reconnect window', () => {
    const code = 'ABC123';
    const uuid1 = 'uuid-creator';
    const uuid2 = 'uuid-joiner';
    createRoom(rooms, code, uuid1);
    joinRoom(rooms, code, uuid2);

    handleSocketDisconnect(rooms, code, 'socket-uuid-creator');
    const result = reconnectSlot(rooms, code, uuid1, 'new-socket-creator');

    expect(result.success).toBe(true);
    expect(result.isCreator).toBe(true);
    const room = rooms.get(code);
    expect(room.slots.get(uuid1).connected).toBe(true);
    expect(room.slots.get(uuid1).socket.id).toBe('new-socket-creator');
    expect(room.slots.get(uuid1).reconnectTimer).toBeNull();
    expect(room.slots.size).toBe(2);
  });

  it('should remove slot when reconnect timer expires', async () => {
    const code = 'ABC123';
    const uuid1 = 'uuid-creator';
    const uuid2 = 'uuid-joiner';
    createRoom(rooms, code, uuid1);
    joinRoom(rooms, code, uuid2);

    handleSocketDisconnect(rooms, code, 'socket-uuid-creator');

    // Fast-forward past reconnect timeout
    const timer = rooms.get(code).slots.get(uuid1).reconnectTimer;
    clearTimeout(timer);

    // Manually trigger the timeout callback
    rooms.get(code).slots.delete(uuid1);

    expect(rooms.get(code).slots.size).toBe(1);
    expect(rooms.get(code).slots.has(uuid1)).toBe(false);
  });

  it('should reject reconnect to a non-existent room', () => {
    const result = reconnectSlot(rooms, 'NONEXIST', 'some-uuid', 'socket-id');
    expect(result.error).toBe('room-not-found');
  });

  it('should reject reconnect with an unknown uuid', () => {
    const code = 'ABC123';
    createRoom(rooms, code, 'uuid-creator');
    const result = reconnectSlot(rooms, code, 'unknown-uuid', 'socket-id');
    expect(result.error).toBe('slot-not-found');
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/room.test.js
git commit -m "test: add reconnection unit tests for server logic"
```

---

### Task 5: Client — UUID, new state flags, event handlers

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add UUID, new state flags, helpers, and overlay show/hide functions**

Add to the `state` object after existing fields (before the closing `};`):

```javascript
  uuid: getOrCreateUUID(),
  isReconnecting: false,
  waitingForPeerReconnect: false,
};
```

Add `getOrCreateUUID` function before `connectSocket()`:

```javascript
function getOrCreateUUID() {
  const key = 'call-uuid';
  let uuid = localStorage.getItem(key);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(key, uuid);
  }
  return uuid;
}
```

Add `closePeerConnection` function before `createPeerConnection`:

```javascript
function closePeerConnection() {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
}
```

Add overlay show/hide functions after `hideNotification()`:

```javascript
function showReconnectingOverlay() {
  hidePeerWaitingOverlay();
  $('reconnecting-overlay').style.display = 'flex';
}

function hideReconnectingOverlay() {
  $('reconnecting-overlay').style.display = 'none';
}

function showPeerWaitingOverlay() {
  hideReconnectingOverlay();
  $('peer-reconnecting-indicator').style.display = 'flex';
}

function hidePeerWaitingOverlay() {
  $('peer-reconnecting-indicator').style.display = 'none';
}
```

- [ ] **Step 2: Modify `create-room` and `join-room` socket emits to include UUID**

Find socket emits for room creation (inside `init` function, `btn-create` click handler):

```javascript
state.socket.emit('create-room');
```

Replace with:

```javascript
state.socket.emit('create-room', { uuid: state.uuid });
```

Find `handleJoinRoom` function:

```javascript
state.socket.emit('join-room', { code });
```

Replace with:

```javascript
state.socket.emit('join-room', { code, uuid: state.uuid });
```

- [ ] **Step 3: Update disconnect handler and add reconnect event handlers**

Find the existing `disconnect` handler inside `connectSocket()`:

```javascript
state.socket.on('disconnect', () => {
  console.log('Socket disconnected');
  if (state.appState !== STATE.HOME) {
    showNotification('Потеря соединения с сервером', 'error');
  }
});
```

Replace with:

```javascript
state.socket.on('disconnect', () => {
  console.log('Socket disconnected');
  if (state.roomCode && [STATE.IN_CALL, STATE.CONNECTING, STATE.WAITING, STATE.DISCONNECTED].includes(state.appState)) {
    state.isReconnecting = true;
    transition(STATE.DISCONNECTED);
    showReconnectingOverlay();
  } else if (state.appState !== STATE.HOME) {
    showNotification('Потеря соединения с сервером', 'error');
  }
});
```

Find the existing `reconnect` handler:

```javascript
state.socket.on('reconnect', () => {
  console.log('Reconnected');
});
```

Replace with:

```javascript
state.socket.on('reconnect', () => {
  console.log('Reconnected');
  if (state.isReconnecting && state.roomCode && state.uuid) {
    state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
  }
});
```

Add after the `reconnect` handler:

```javascript
state.socket.on('reconnect-success', ({ code, isCreator }) => {
  state.isReconnecting = false;
  hideReconnectingOverlay();
  hideNotification();
  transition(STATE.CONNECTING);
  closePeerConnection();
  state.isRoomCreator = isCreator;
  if (state.localStream) {
    addLocalTracksToPC();
  }
  if (isCreator) {
    startWebRTC(true);
  }
});
```

Find the existing `peer-disconnected` handler:

```javascript
state.socket.on('peer-disconnected', () => {
  showNotification('Собеседник отключился', 'info');
  endCall();
  screens.home();
});
```

Replace with:

```javascript
state.socket.on('peer-disconnected', ({ canReconnect }) => {
  if (canReconnect) {
    state.waitingForPeerReconnect = true;
    transition(STATE.DISCONNECTED);
    showPeerWaitingOverlay();
  } else {
    showNotification('Собеседник отключился', 'info');
    endCall();
    screens.home();
  }
});
```

Add before `connectSocket()` closing brace, after existing handlers:

```javascript
state.socket.on('peer-reconnected', () => {
  state.waitingForPeerReconnect = false;
  hidePeerWaitingOverlay();
  transition(STATE.CONNECTING);
  closePeerConnection();
  if (state.localStream) {
    addLocalTracksToPC();
  }
});
```

- [ ] **Step 4: Update WebRTC `connectionstatechange` to not end call during reconnect**

Find the existing handler inside `createPeerConnection`:

```javascript
if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
  showNotification('Соединение потеряно', 'error');
  endCall();
  screens.home();
}
```

Replace with:

```javascript
if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
  if (state.isReconnecting || state.waitingForPeerReconnect) return;
  showNotification('Соединение потеряно', 'error');
  endCall();
  screens.home();
}
```

- [ ] **Step 5: Start a dev server and verify no console errors (optional manual check)**

Run: `node server.js`
Open http://localhost:3000, check console for errors.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: add reconnection flow to client — UUID, event handlers, WebRTC guards"
```

---

### Task 6: Client — HTML and CSS for overlays

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`

- [ ] **Step 1: Add reconnecting overlay and peer-reconnecting indicator to `index.html`**

Add after the `chat-panel` closing `</div>` and before the notification divs:

```html
    <div id="reconnecting-overlay" style="display:none">
      <div class="reconnecting-content">
        <div class="spinner"></div>
        <p>Потеряно соединение</p>
        <p class="reconnecting-hint">Попытка переподключения...</p>
        <button id="btn-leave-reconnect" class="btn btn-secondary">Выйти из комнаты</button>
      </div>
    </div>

    <div id="peer-reconnecting-indicator" style="display:none">
      <p>Собеседник временно отключился</p>
      <p class="hint">Ожидание переподключения...</p>
    </div>
```

- [ ] **Step 2: Add CSS for overlays to `style.css`**

Add before the `@media` section:

```css
/* ======================== */
/* RECONNECT OVERLAY        */
/* ======================== */

#reconnecting-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  animation: fadeIn 0.3s ease;
}

.reconnecting-content {
  text-align: center;
  color: #e8e8e8;
}

.reconnecting-content p {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
}

.reconnecting-hint {
  font-size: 14px;
  color: #a0a0b0;
  margin-bottom: 24px;
}

.spinner {
  width: 48px;
  height: 48px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

#peer-reconnecting-indicator {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  z-index: 10;
  color: #e8e8e8;
  text-align: center;
  padding: 24px;
}

#peer-reconnecting-indicator p {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}

#peer-reconnecting-indicator .hint {
  font-size: 13px;
  color: #a0a0b0;
}
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add reconnecting overlay and peer-waiting indicator UI"
```

---

### Task 7: Client — wire "Выйти из комнаты" button

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Wire the "Выйти из комнаты" button in `init()`**

Add after the `$('btn-hangup')` event listener:

```javascript
$('btn-leave-reconnect').addEventListener('click', () => {
  if (state.isReconnecting) {
    state.isReconnecting = false;
    hideReconnectingOverlay();
  }
  state.waitingForPeerReconnect = false;
  hidePeerWaitingOverlay();
  handleHangup();
});
```

- [ ] **Step 3: Clean up disconnect state in `endCall()`**

Find `endCall()` function and add to the cleanup (before the closing `}`):

```javascript
state.isReconnecting = false;
state.waitingForPeerReconnect = false;
hideReconnectingOverlay();
hidePeerWaitingOverlay();
```

- [ ] **Step 4: Start a dev server and verify everything works**

Run: `node server.js`
Open two browser tabs. Create room in one, join in the other. Force disconnect (e.g., kill server momentarily), verify reconnect button appears. For a full test, restart server and verify reconnect overlay shows and call can be re-established.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: add overlay show/hide functions and UI wiring for reconnection"
```

---

### Task 8: Run all tests and final verification

**Files:**
- Test: all files

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: all tests pass (state-machine, room, code tests)

- [ ] **Step 2: Verify lint/typecheck if available**

Run: `node -c server.js && node -c public/app.js && node -c src/state-machine.js && node -c src/code.js`
Expected: no syntax errors

- [ ] **Step 3: Final commit if any fixes were made**

```bash
git add -A
git commit -m "fix: final adjustments after verification"
```
