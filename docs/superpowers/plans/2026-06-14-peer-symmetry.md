# Peer Symmetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `isCreator` privilege, make both room participants equal peers using UUID tie-breaker for WebRTC offer/answer role.

**Architecture:** Replace `isCreator` flag with deterministic `shouldCreateOffer(myUuid, peerUuid)` based on lexicographic UUID comparison. Server returns `peerUuid` instead of `isCreator` in events. Both sides independently compute their role.

**Tech Stack:** Node.js, Socket.IO, WebRTC, Vitest

---

### Task 1: Add `getPeerUuid` helper to RoomManager

**Files:**
- Modify: `src/room-manager.js` (add method after `getOtherSocket`)
- Test: `tests/room-manager.test.js`

- [ ] **Step 1: Write failing test for `getPeerUuid`**

Add to `tests/room-manager.test.js`:
```javascript
it('should return peer UUID when room has two participants', () => {
  const uuid1 = 'aaa';
  const uuid2 = 'bbb';
  const socket1 = { id: 'socket-1', emit: vi.fn(), join: vi.fn() };
  const socket2 = { id: 'socket-2', emit: vi.fn(), join: vi.fn() };
  const { code } = roomManager.createRoom(uuid1, socket1);
  roomManager.joinRoom(code, uuid2, socket2);
  
  expect(roomManager.getPeerUuid(code, uuid1)).toBe(uuid2);
  expect(roomManager.getPeerUuid(code, uuid2)).toBe(uuid1);
});

it('should return null when room has no peer', () => {
  const uuid1 = 'aaa';
  const socket1 = { id: 'socket-1', emit: vi.fn(), join: vi.fn() };
  const { code } = roomManager.createRoom(uuid1, socket1);
  
  expect(roomManager.getPeerUuid(code, uuid1)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/room-manager.test.js -t "getPeerUuid" --reporter verbose`
Expected: FAIL - `getPeerUuid is not a function`

- [ ] **Step 3: Add `getPeerUuid` method to RoomManager**

Add after `getOtherSocket` in `src/room-manager.js`:
```javascript
getPeerUuid(code, uuid) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return null;
    
    for (const slot of room.slots.values()) {
      if (slot.uuid !== uuid) {
        return slot.uuid;
      }
    }
    return null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/room-manager.test.js -t "getPeerUuid" --reporter verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/room-manager.js tests/room-manager.test.js
git commit -m "feat: add getPeerUuid helper to RoomManager"
```

---

### Task 2: Remove `isCreator` from Slot and `reconnectToRoom` response

**Files:**
- Modify: `src/room-manager.js`
- Test: `tests/room.test.js`

- [ ] **Step 1: Update tests that check `isCreator` in reconnect response**

Replace all `isCreator` assertions in `tests/room.test.js` with `peerUuid` assertions:

Test at line 152-165 — replace `isCreator` assertion:
```javascript
it('should return peerUuid on reconnect', () => {
    const socket1 = createMockSocket('socket-1');
    const socket2 = createMockSocket('socket-2');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    roomManager.joinRoom(code, 'uuid-2', socket2);
    
    roomManager.handleDisconnect(socket1);
    const result1 = roomManager.reconnectToRoom(code, 'uuid-1', createMockSocket('socket-new-1'));
    expect(result1.peerUuid).toBe('uuid-2');
    
    roomManager.handleDisconnect(socket2);
    const result2 = roomManager.reconnectToRoom(code, 'uuid-2', createMockSocket('socket-new-2'));
    expect(result2.peerUuid).toBe('uuid-1');
});
```

Test at line 239-259 — replace `isCreator` assertions:
```javascript
it('should handle both users disconnecting and reconnecting', () => {
    const socket1 = createMockSocket('socket-1');
    const socket2 = createMockSocket('socket-2');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    roomManager.joinRoom(code, 'uuid-2', socket2);
    
    roomManager.handleDisconnect(socket1);
    roomManager.handleDisconnect(socket2);
    
    const result1 = roomManager.reconnectToRoom(code, 'uuid-1', createMockSocket('socket-new-1'));
    expect(result1.success).toBe(true);
    expect(result1.peerUuid).toBe('uuid-2');
    
    const result2 = roomManager.reconnectToRoom(code, 'uuid-2', createMockSocket('socket-new-2'));
    expect(result2.success).toBe(true);
    expect(result2.peerUuid).toBe('uuid-1');
    
    const room = roomManager.getRoom(code);
    expect(room.slots.get('uuid-1').connected).toBe(true);
    expect(room.slots.get('uuid-2').connected).toBe(true);
});
```

Also remove the old `isCreator` test at line 152-165.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/room.test.js --reporter verbose`
Expected: FAIL - `result1.isCreator` is undefined, `result1.peerUuid` doesn't exist yet

- [ ] **Step 3: Remove `isCreator` from Slot in both `createRoom` and `joinRoom`**

In `src/room-manager.js`, change `createRoom`:
```javascript
// Before:
const slot = {
  uuid,
  socket,
  isCreator: true,
  connected: true,
  reconnectTimer: null,
  disconnectedAt: null,
};
// After:
const slot = {
  uuid,
  socket,
  connected: true,
  reconnectTimer: null,
  disconnectedAt: null,
};
```

Same change in `joinRoom`:
```javascript
// Before:
const slot = {
  uuid,
  socket,
  isCreator: false,
  connected: true,
  reconnectTimer: null,
  disconnectedAt: null,
};
// After:
const slot = {
  uuid,
  socket,
  connected: true,
  reconnectTimer: null,
  disconnectedAt: null,
};
```

- [ ] **Step 4: Update `reconnectToRoom` to return `peerUuid` instead of `isCreator`**

In `src/room-manager.js`, replace the return in `reconnectToRoom`:
```javascript
// Before:
const elapsed = Date.now() - (slot.disconnectedAt || Date.now());
const reconnectWindow = Math.max(0, RECONNECT_TIMEOUT - elapsed);

return {
  success: true,
  code: code.toUpperCase(),
  isCreator: slot.isCreator,
  reconnectWindow,
};

// After:
const elapsed = Date.now() - (slot.disconnectedAt || Date.now());
const reconnectWindow = Math.max(0, RECONNECT_TIMEOUT - elapsed);

let peerUuid = null;
for (const s of room.slots.values()) {
  if (s.uuid !== uuid) {
    peerUuid = s.uuid;
    break;
  }
}

return {
  success: true,
  code: code.toUpperCase(),
  peerUuid,
  reconnectWindow,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/room.test.js tests/room-manager.test.js tests/resource-leaks.test.js --reporter verbose`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/room-manager.js tests/room.test.js
git commit -m "feat: remove isCreator from Slot, return peerUuid instead of isCreator"
```

---

### Task 3: Update server.js events to send `peerUuid` and `uuid`

**Files:**
- Modify: `server.js`
- Test: `tests/integration.test.js`

- [ ] **Step 1: Update integration tests to expect `peerUuid`**

In `tests/integration.test.js`:

Replace `reconnect-success` assertion (line 101-103):
```javascript
clientSocket2.on('reconnect-success', ({ code, peerUuid, reconnectWindow }) => {
  expect(code).toBe(roomCode);
  expect(peerUuid).toBe(uuid1);
  expect(typeof reconnectWindow).toBe('number');
  expect(reconnectWindow).toBeGreaterThan(0);
  done();
});
```

Replace second `reconnect-success` for both clients (lines 228-243):
```javascript
clientSocket1.on('reconnect-success', ({ code, peerUuid, reconnectWindow }) => {
  expect(code).toBe(roomCode);
  expect(peerUuid).toBe(uuid2);
  expect(reconnectWindow).toBeGreaterThan(0);
  socket1Reconnected = true;
  checkBothReconnected();
});

clientSocket2.on('reconnect-success', ({ code, peerUuid, reconnectWindow }) => {
  expect(code).toBe(roomCode);
  expect(peerUuid).toBe(uuid1);
  expect(reconnectWindow).toBeGreaterThan(0);
  socket2Reconnected = true;
  checkBothReconnected();
});
```

Add `room-joined` peerUuid test. Replace existing (line 66-68):
```javascript
clientSocket2.on('room-joined', ({ code, peerUuid }) => {
  expect(code).toBe(roomCode);
  expect(peerUuid).toBe(uuid1);
  clientSocket1.emit('leave-room');
});
```

Add `user-joined` uuid test. Replace existing (line 125-127):
```javascript
clientSocket2.on('user-joined', ({ uuid }) => {
  expect(uuid).toBe(uuid2);
  clientSocket1.emit('send-message', { text: testMessage });
});
```

- [ ] **Step 2: Run integration tests to verify they fail**

Run: `npx vitest run tests/integration.test.js --reporter verbose`
Expected: FAIL - events don't include `peerUuid` yet

- [ ] **Step 3: Update server.js event payloads**

In `server.js`:

`join-room` handler — add `peerUuid` to `room-joined`:
```javascript
socket.emit('room-joined', { code: result.code, peerUuid: roomManager.getPeerUuid(result.code, sanitizedUUID) });
```

`user-joined` — include uuid:
```javascript
otherSocket.emit('user-joined', { uuid: sanitizedUUID, userId: socket.id });
```

`reconnect-room` handler — replace `isCreator` with `peerUuid`:
```javascript
socket.emit('reconnect-success', {
  code: result.code,
  peerUuid: result.peerUuid,
  reconnectWindow: result.reconnectWindow,
});
```

- [ ] **Step 4: Run integration tests to verify they pass**

Run: `npx vitest run tests/integration.test.js --reporter verbose`
Expected: All PASS (except possibly the reconnect timeout test due to timing)

- [ ] **Step 5: Run all server tests**

Run: `npx vitest run --reporter verbose`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server.js tests/integration.test.js
git commit -m "feat: update server events to send peerUuid instead of isCreator"
```

---

### Task 4: Update client app.js — add `shouldCreateOffer` and `peerUuid`

**Files:**
- Modify: `public/app.js`

No client-side tests exist for app.js. Changes are manually verified.

- [ ] **Step 1: Add `shouldCreateOffer` function after `transition` function**

Add after line 41 (`return true; }`):
```javascript
function shouldCreateOffer(myUuid, peerUuid) {
  return myUuid < peerUuid;
}
```

- [ ] **Step 2: Replace `isRoomCreator: false` with `peerUuid: null` in state**

Replace line 9:
```javascript
// Before:
isRoomCreator: false,
// After:
peerUuid: null,
```

- [ ] **Step 3: Update `room-created` handler**

Replace line 153-158:
```javascript
state.socket.on('room-created', ({ code }) => {
    state.roomCode = code;
    state.peerUuid = null;
    transition(STATE.WAITING);
    enterRoom(code);
});
```

- [ ] **Step 4: Update `room-joined` handler**

Replace line 160-165:
```javascript
state.socket.on('room-joined', ({ code, peerUuid }) => {
    state.roomCode = code;
    state.peerUuid = peerUuid;
    transition(STATE.WAITING);
    enterRoom(code);
});
```

- [ ] **Step 5: Update `user-joined` handler**

Replace line 167-181:
```javascript
state.socket.on('user-joined', ({ uuid }) => {
    state.peerUuid = uuid;
    showNotification('Пользователь подключился', 'success');
    transition(STATE.CONNECTING);
    if (state.socket && state.localStream) {
      const audioTrack = state.localStream.getAudioTracks()[0];
      if (audioTrack && !audioTrack.enabled) {
        state.socket.emit('audio-state-change', { muted: true });
      }
    }
    if (state.localStream) {
      startWebRTC();
    } else {
      state.pendingStartWebRTC = true;
    }
});
```

- [ ] **Step 6: Update `reconnect-success` handler**

Replace line 140-150:
```javascript
state.socket.on('reconnect-success', ({ code, peerUuid, reconnectWindow }) => {
    state.isReconnecting = false;
    retryState.attempt = 0;
    clearTimeout(retryState.timer);
    hideReconnectingOverlay();
    hideNotification();
    transition(STATE.CONNECTING);

    state.peerUuid = peerUuid;
    if (shouldCreateOffer(state.uuid, state.peerUuid)) {
      restartIce();
    } else {
      closePeerConnection();
    }
});
```

- [ ] **Step 7: Update `peer-reconnected` handler**

Replace line 267-277:
```javascript
state.socket.on('peer-reconnected', () => {
    state.waitingForPeerReconnect = false;
    hidePeerWaitingOverlay();
    transition(STATE.CONNECTING);

    if (shouldCreateOffer(state.uuid, state.peerUuid)) {
      restartIce();
    } else {
      closePeerConnection();
    }
});
```

- [ ] **Step 8: Update `startWebRTC` — remove parameter, use UUID check**

Replace function:
```javascript
async function startWebRTC() {
  const pc = createPeerConnection();

  if (shouldCreateOffer(state.uuid, state.peerUuid)) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      state.socket.emit('offer', { sdp: pc.localDescription });
    } catch (err) {
      console.error('createOffer error:', err);
      showNotification('Ошибка создания предложения', 'error');
    }
  }
}
```

- [ ] **Step 9: Update `restartIce` — remove `isRoomCreator` check**

Replace function:
```javascript
async function restartIce() {
  const pc = state.peerConnection;
  if (!pc || pc.signalingState === 'closed') {
    createPeerConnection();
    if (state.localStream) addLocalTracksToPC();
    startWebRTC();
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
    startWebRTC();
  }
}
```

- [ ] **Step 10: Update `enterRoom` — remove `startWebRTC(true)` hardcode**

Replace the `pendingStartWebRTC` check inside `enterRoom`:
```javascript
function enterRoom(code) {
  closeModal();
  state.roomCode = code;
  $('room-code').textContent = code;
  screens.room();

  getLocalMedia().then((hasMedia) => {
    if (hasMedia) {
      $('local-placeholder').style.display = 'none';
      addLocalTracksToPC();
    }
    if (state.pendingStartWebRTC && hasMedia) {
      state.pendingStartWebRTC = false;
      startWebRTC();
    }
    if (state.pendingOffer) {
      const sdp = state.pendingOffer;
      state.pendingOffer = null;
      handleOffer(sdp);
    }
  });
}
```

- [ ] **Step 11: Update `endCall` — reset `peerUuid`**

Replace line 566-567:
```javascript
state.roomCode = null;
state.peerUuid = null;
state.pendingStartWebRTC = false;
```

- [ ] **Step 12: Run all tests to verify no regressions**

Run: `npx vitest run --reporter verbose`
Expected: All PASS

- [ ] **Step 13: Commit**

```bash
git add public/app.js
git commit -m "feat: replace isRoomCreator with UUID tie-breaker in client"
```

---

### Task 5: Clean up — remove remaining `isCreator` references

**Files:**
- Search repo for any remaining `isCreator` or `isRoomCreator` references

- [ ] **Step 1: Search for remaining references**

Run: `rg -n 'isCreator\|isRoomCreator' --no-heading`

Expected: No matches. If any found in docs/comments, update them.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run --reporter verbose`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove remaining isCreator references"
```
