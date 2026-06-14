# Reconnection Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix reconnection flow — add manual retry button, ICE restart, retry with exponential backoff, and proper WebRTC restart for both peers.

**Architecture:** Three layers: server (`room-manager.js`) tracks `disconnectedAt` per slot and returns `reconnectWindow`; client (`app.js`) adds `restartIce()`, `scheduleRetry()`, and button handlers; UI (`index.html` + `style.css`) adds retry/leave buttons to overlays.

**Tech Stack:** Node.js + Socket.IO (server), vanilla JS (client), Vitest (tests)

---

### Task 1: Server-side — Add `disconnectedAt` to Slot + return `reconnectWindow`

**Files:**
- Modify: `src/room-manager.js`

**Goal:** Track when a user disconnected, and return remaining reconnect window on successful reconnect.

- [ ] **Step 1: Add `disconnectedAt` to slot creation in `createRoom`**

In `src/room-manager.js:24-30`, add `disconnectedAt: null` to the slot object:

```javascript
const slot = {
  uuid,
  socket,
  isCreator: true,
  connected: true,
  reconnectTimer: null,
  disconnectedAt: null,
};
```

- [ ] **Step 2: Add `disconnectedAt` to slot creation in `joinRoom`**

In `src/room-manager.js:79-85`, add `disconnectedAt: null`:

```javascript
const slot = {
  uuid,
  socket,
  isCreator: false,
  connected: true,
  reconnectTimer: null,
  disconnectedAt: null,
};
```

- [ ] **Step 3: Set `disconnectedAt` in `handleDisconnect`**

In `src/room-manager.js:151-152`, after `slot.connected = false`, add:

```javascript
slot.disconnectedAt = Date.now();
```

- [ ] **Step 4: Return `reconnectWindow` from `reconnectToRoom`**

In `src/room-manager.js:190-217`, after the reconnect timer is cleared and socket is restored, calculate reconnect window and include it in the return value:

```javascript
  // After slot.socket = socket; slot.connected = true;

  const elapsed = Date.now() - (slot.disconnectedAt || Date.now());
  const reconnectWindow = Math.max(0, RECONNECT_TIMEOUT - elapsed);

  return {
    success: true,
    code: code.toUpperCase(),
    isCreator: slot.isCreator,
    reconnectWindow,
  };
```

**Result:** `reconnectToRoom` now returns `{ success, code, isCreator, reconnectWindow }`.

- [ ] **Step 5: Run existing tests**

Run: `npx vitest run tests/room.test.js tests/room-manager.test.js`
Expected: All pass (new fields are backwards-compatible, no existing behavior changed).

- [ ] **Step 6: Commit**

```bash
git add src/room-manager.js
git commit -m "feat: add disconnectedAt and reconnectWindow to room manager"
```

---

### Task 2: Server-side — Pass `reconnectWindow` to `reconnect-success` event

**Files:**
- Modify: `server.js:133-158`

**Goal:** Forward `reconnectWindow` from `reconnectToRoom` to the client via the `reconnect-success` event.

- [ ] **Step 1: Update `reconnect-room` handler in `server.js`**

In `server.js:152`, change the `reconnect-success` emit to include `reconnectWindow`:

```javascript
// Before:
socket.emit('reconnect-success', { code: result.code, isCreator: result.isCreator });

// After:
socket.emit('reconnect-success', {
  code: result.code,
  isCreator: result.isCreator,
  reconnectWindow: result.reconnectWindow,
});
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run tests/server.test.js tests/integration.test.js`
Expected: All pass (new field doesn't break existing assertions; integration tests check `reconnect-success` but don't assert on new field).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: emit reconnectWindow in reconnect-success event"
```

---

### Task 3: Client-side — Add retry infrastructure and `restartIce()`

**Files:**
- Modify: `public/app.js`

**Goal:** Add state variables, `restartIce()` for ICE restart or full PC recreation, `scheduleRetry()` for exponential backoff, and `updateReconnectStatus()` for UI feedback.

- [ ] **Step 1: Add `RECONNECT_CONFIG` and `retryState` after existing state object**

In `public/app.js`, after the existing `state` object (around line 19), add:

```javascript
const RECONNECT_CONFIG = {
  maxAttempts: 5,
  baseDelay: 1000,
  maxDelay: 30000,
};

const retryState = {
  attempt: 0,
  timer: null,
};
```

- [ ] **Step 2: Add `restartIce()` function after `handleIceCandidate`**

In `public/app.js`, after `handleIceCandidate` function (around line 440), add:

```javascript
async function restartIce() {
  const pc = state.peerConnection;
  if (!pc || pc.signalingState === 'closed') {
    createPeerConnection();
    if (state.localStream) addLocalTracksToPC();
    if (state.isRoomCreator) startWebRTC(true);
    return;
  }

  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    if (state.socket && state.roomCode) {
      state.socket.emit('offer', { sdp: pc.localDescription });
    }
  } catch (err) {
    console.error('ICE restart failed, fallback to full renegotiation:', err);
    closePeerConnection();
    createPeerConnection();
    if (state.localStream) addLocalTracksToPC();
    if (state.isRoomCreator) startWebRTC(true);
  }
}
```

- [ ] **Step 3: Add `scheduleRetry()` function**

In `public/app.js`, after `restartIce()`, add:

```javascript
function scheduleRetry() {
  if (retryState.attempt >= RECONNECT_CONFIG.maxAttempts) return;
  if (!state.isReconnecting) return;

  const delay = Math.min(
    RECONNECT_CONFIG.baseDelay * Math.pow(2, retryState.attempt),
    RECONNECT_CONFIG.maxDelay
  );
  retryState.attempt++;

  retryState.timer = setTimeout(() => {
    if (!state.isReconnecting) return;
    updateReconnectStatus(`Попытка ${retryState.attempt}/${RECONNECT_CONFIG.maxAttempts}...`);

    if (!state.socket.connected) {
      state.socket.connect();
    }
    if (state.socket.connected && state.roomCode && state.uuid) {
      state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
    } else {
      state.socket.once('connect', () => {
        if (state.roomCode && state.uuid) {
          state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
        }
      });
    }
  }, delay);
}
```

- [ ] **Step 4: Add `updateReconnectStatus()` function**

```javascript
function updateReconnectStatus(text) {
  const el = document.getElementById('reconnect-status');
  if (el) el.textContent = text;
}
```

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: add restartIce, scheduleRetry, and reconnect config"
```

---

### Task 4: Client-side — Update event handlers

**Files:**
- Modify: `public/app.js`

**Goal:** Update `connectSocket()` for Socket.IO config, modify `reconnect-success`, `peer-reconnected`, `disconnect` handlers, and `endCall()` for retry cleanup.

- [ ] **Step 1: Update `connectSocket()` — add reconnection config**

In `public/app.js:93-96`, update the Socket.IO constructor:

```javascript
// Before:
state.socket = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

// After:
state.socket = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
});
```

- [ ] **Step 2: Modify `reconnect-success` handler (line 124-134)**

Replace the existing handler:

```javascript
// Before:
state.socket.on('reconnect-success', ({ code, isCreator }) => {
  state.isReconnecting = false;
  hideReconnectingOverlay();
  hideNotification();
  transition(STATE.CONNECTING);
  closePeerConnection();
  state.isRoomCreator = isCreator;
  if (isCreator) {
    startWebRTC(true);
  }
});

// After:
state.socket.on('reconnect-success', ({ code, isCreator }) => {
  state.isReconnecting = false;
  retryState.attempt = 0;
  clearTimeout(retryState.timer);
  hideReconnectingOverlay();
  hideNotification();
  transition(STATE.CONNECTING);

  state.isRoomCreator = isCreator;
  restartIce();
});
```

- [ ] **Step 3: Modify `peer-reconnected` handler (line 250-255)**

Replace the existing handler:

```javascript
// Before:
state.socket.on('peer-reconnected', ({ uuid }) => {
  state.waitingForPeerReconnect = false;
  hidePeerWaitingOverlay();
  transition(STATE.CONNECTING);
  closePeerConnection();
});

// After:
state.socket.on('peer-reconnected', ({ uuid }) => {
  state.waitingForPeerReconnect = false;
  hidePeerWaitingOverlay();
  transition(STATE.CONNECTING);

  if (state.isRoomCreator) {
    restartIce();
  } else {
    closePeerConnection();
  }
});
```

- [ ] **Step 4: Modify `disconnect` handler (line 102-110)**

Replace the existing handler to call `scheduleRetry()`:

```javascript
// Before:
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

// After:
state.socket.on('disconnect', () => {
  console.log('Socket disconnected');
  if (state.roomCode && [STATE.IN_CALL, STATE.CONNECTING, STATE.WAITING, STATE.DISCONNECTED].includes(state.appState)) {
    state.isReconnecting = true;
    transition(STATE.DISCONNECTED);
    showReconnectingOverlay();
    scheduleRetry();
  } else if (state.appState !== STATE.HOME) {
    showNotification('Потеря соединения с сервером', 'error');
  }
});
```

- [ ] **Step 5: Modify `endCall()` — clear retry state**

In `public/app.js:442-484`, at the beginning of `endCall()`, add retry cleanup:

```javascript
function endCall() {
  clearTimeout(retryState.timer);
  retryState.attempt = 0;

  // existing code below...
}
```

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: update reconnect handlers and add retry on disconnect"
```

---

### Task 5: Client-side — Add button handlers

**Files:**
- Modify: `public/app.js`

**Goal:** Add handlers for `btn-retry-reconnect` (manual retry) and `btn-leave-peer-reconnect` (leave while waiting for peer).

- [ ] **Step 1: Update `btn-leave-reconnect` handler to also clear retry state**

In `public/app.js:811-819`, modify the existing handler:

```javascript
// Before:
$('btn-leave-reconnect').addEventListener('click', () => {
  if (state.isReconnecting) {
    state.isReconnecting = false;
    hideReconnectingOverlay();
  }
  state.waitingForPeerReconnect = false;
  hidePeerWaitingOverlay();
  handleHangup();
});

// After:
$('btn-leave-reconnect').addEventListener('click', () => {
  clearTimeout(retryState.timer);
  retryState.attempt = 0;
  if (state.isReconnecting) {
    state.isReconnecting = false;
    hideReconnectingOverlay();
  }
  state.waitingForPeerReconnect = false;
  hidePeerWaitingOverlay();
  handleHangup();
});
```

- [ ] **Step 2: Add `btn-retry-reconnect` handler after `btn-leave-reconnect`**

```javascript
$('btn-retry-reconnect').addEventListener('click', () => {
  retryState.attempt = 0;
  clearTimeout(retryState.timer);
  updateReconnectStatus('Повторная попытка...');

  if (!state.socket.connected) {
    state.socket.connect();
  }

  const tryNow = () => {
    if (state.roomCode && state.uuid) {
      state.socket.emit('reconnect-room', { code: state.roomCode, uuid: state.uuid });
    }
  };

  if (state.socket.connected) {
    tryNow();
  } else {
    state.socket.once('connect', tryNow);
  }
});
```

- [ ] **Step 3: Add `btn-leave-peer-reconnect` handler after `btn-retry-reconnect`**

```javascript
$('btn-leave-peer-reconnect').addEventListener('click', () => {
  state.waitingForPeerReconnect = false;
  hidePeerWaitingOverlay();
  handleHangup();
});
```

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: add retry and peer-reconnect-leave button handlers"
```

---

### Task 6: UI — Update HTML templates

**Files:**
- Modify: `public/index.html`

**Goal:** Add retry button to `reconnecting-overlay`, add `reconnect-status` element, add leave button to `peer-reconnecting-indicator`.

- [ ] **Step 1: Update `reconnecting-overlay` (lines 136-143)**

Replace the existing block:

```html
<!-- Before: -->
<div id="reconnecting-overlay" style="display:none">
  <div class="reconnecting-content">
    <div class="spinner"></div>
    <p>Потеряно соединение</p>
    <p class="reconnecting-hint">Попытка переподключения...</p>
    <button id="btn-leave-reconnect" class="btn btn-secondary">Выйти из комнаты</button>
  </div>
</div>

<!-- After: -->
<div id="reconnecting-overlay" style="display:none">
  <div class="reconnecting-content">
    <div class="spinner"></div>
    <p>Потеряно соединение</p>
    <p class="reconnecting-hint" id="reconnect-status">
      Попытка переподключения...
    </p>
    <div class="reconnect-buttons">
      <button id="btn-retry-reconnect" class="btn btn-secondary">
        Повторить попытку
      </button>
      <button id="btn-leave-reconnect" class="btn btn-secondary btn-danger">
        Выйти из комнаты
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Update `peer-reconnecting-indicator` (lines 145-148)**

Add a leave button:

```html
<!-- Before: -->
<div id="peer-reconnecting-indicator" style="display:none">
  <p>Собеседник временно отключился</p>
  <p class="hint">Ожидание переподключения...</p>
</div>

<!-- After: -->
<div id="peer-reconnecting-indicator" style="display:none">
  <p>Собеседник временно отключился</p>
  <p class="hint">Ожидание переподключения...</p>
  <button id="btn-leave-peer-reconnect" class="btn btn-secondary btn-danger">
    Выйти из комнаты
  </button>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add retry button and peer reconnect leave button to overlays"
```

---

### Task 7: UI — Add CSS styles

**Files:**
- Modify: `public/style.css`

**Goal:** Add styles for `.reconnect-buttons` and `.btn-danger`.

- [ ] **Step 1: Add styles for reconnect buttons and danger button variant**

Find the end of the style file (or before `#peer-reconnecting-indicator` section if it exists), and add:

```css
.reconnect-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
}

#btn-retry-reconnect {
  min-width: 200px;
}

.btn-danger {
  background: rgba(220, 50, 50, 0.2);
  color: #e05050;
  border: 1px solid rgba(220, 50, 50, 0.4);
}

.btn-danger:hover {
  background: rgba(220, 50, 50, 0.35);
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: add styles for reconnect buttons and danger variant"
```

---

### Task 8: Run all tests and verify

**Goal:** Ensure all changes are backwards-compatible and existing tests pass.

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Run linter if available**

```bash
npx eslint public/app.js server.js src/room-manager.js 2>/dev/null || echo "No linter configured"
```

If there are lint errors, fix them.

- [ ] **Step 3: Update existing integration test for `reconnectSuccess` to assert `reconnectWindow`**

In `tests/integration.test.js:101-104`, update the assertion:

```javascript
clientSocket2.on('reconnect-success', ({ code, isCreator, reconnectWindow }) => {
  expect(code).toBe(roomCode);
  expect(isCreator).toBe(false);
  expect(typeof reconnectWindow).toBe('number');
  expect(reconnectWindow).toBeGreaterThan(0);
  done();
});
```

- [ ] **Step 4: Run tests again**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration.test.js
git commit -m "test: assert reconnectWindow in reconnect-success integration test"
```

---

### Plan Self-Review

**Spec coverage:**
1. Retry-механизм (exponential backoff) → Task 3 (scheduleRetry) + Task 4 (disconnect handler)
2. ICE restart вместо полного пересоздания PC → Task 3 (restartIce)
3. `peer-reconnected` перезапускает WebRTC для creator → Task 4 (peer-reconnected handler)
4. Кнопка "Повторить попытку" → Task 5 (btn-retry-reconnect handler) + Task 6 (HTML)
5. Кнопка "Выйти" в peer-reconnecting → Task 5 (btn-leave-peer-reconnect) + Task 6 (HTML)
6. `reconnectWindow` на клиенте → Task 1 + Task 2 (server emits, client receives)
7. Socket.IO config (reconnectionDelay) → Task 4 (connectSocket config)
8. retryState сброс в endCall → Task 4 (endCall modification)
9. Стили для кнопок → Task 7

**All spec requirements covered. No placeholders. No type inconsistencies.**
