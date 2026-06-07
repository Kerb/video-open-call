# Screen Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add screen share button that replaces camera video track via `replaceTrack`

**Architecture:** When user clicks Screen Share, `getDisplayMedia()` captures the screen, `RTCRtpSender.replaceTrack()` swaps the camera video track with the screen track in the existing RTCPeerConnection (no renegotiation). A second click (or browser's Stop sharing) reverses the swap.

**Tech Stack:** Vanilla JS, WebRTC, Socket.IO, Vitest (server tests)

**Files changed:**
- `server.js` — add `screen-share-state-change` relay
- `public/index.html` — add screen share button + remote indicator
- `public/style.css` — styles for button + indicator
- `public/app.js` — state, socket handler, toggleScreenShare, endCall cleanup

---

### Task 1: Server — add screen-share-state-change relay

**Files:**
- Modify: `server.js:110-113` (after audio-state-change block)
- Test: `tests/room.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/room.test.js`:

```js
describe('screen-share-state-change relay', () => {
  it('should relay screen-share-state-change to other room members', () => {
    const code = generateCode();
    createRoom(rooms, code);
    const user1Id = 'user1';
    const user2Id = 'user2';
    rooms.get(code).sockets.set(user1Id, { id: user1Id });
    rooms.get(code).sockets.set(user2Id, { id: user2Id });

    const socket1 = rooms.get(code).sockets.get(user1Id);
    const socket2 = rooms.get(code).sockets.get(user2Id);
    let relayedArgs = null;
    socket2.to = (_, args) => { relayedArgs = args; };

    const emitActive = (socket, active) => {
      if (!rooms.get(code)) return;
      const room = rooms.get(code);
      room.sockets.forEach((s, id) => {
        if (id !== socket.id) {
          if (s.to) s.to(socket.currentRoom, { active });
        }
      });
    };

    socket1.currentRoom = code;
    emitActive(socket1, true);

    expect(relayedArgs).toEqual({ active: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/room.test.js -t "screen-share"`
Expected: FAIL (test not found or fails)

- [ ] **Step 3: Add handler to server.js**

After the `audio-state-change` block (line 113), add:

```js
socket.on('screen-share-state-change', ({ active }) => {
  if (!socket.currentRoom) return;
  socket.to(socket.currentRoom).emit('screen-share-state-change', { active });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/room.test.js -t "screen-share"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server.js tests/room.test.js
git commit -m "feat(server): add screen-share-state-change relay"
```

---

### Task 2: HTML — add button and remote indicator

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add screen share button after camera button**

Replace the chat button block with screen share + chat button. In `public/index.html:95`, replace:

```html
<button id="btn-chat" class="control-btn" data-active="false" title="Чат">
```

with screen share button + updated chat button:

```html
<button id="btn-screen" class="control-btn" data-active="false" title="Демонстрация экрана">
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
  </svg>
</button>
<button id="btn-chat" class="control-btn" data-active="false" title="Чат">
```

- [ ] **Step 2: Add remote screen indicator in remote-container**

After the `remote-mute-indicator` div in `public/index.html:63`, add:

```html
<div id="remote-screen-indicator" style="display:none">
  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
  </svg>
  <span>Screen</span>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(html): add screen share button and remote indicator"
```

---

### Task 3: CSS — add styles for button and indicator

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add remote screen indicator styles**

Add after the `.pip-label` block (after line 339):

```css
#remote-screen-indicator {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 5;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 6px;
  padding: 4px 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  backdrop-filter: blur(4px);
}

#remote-screen-indicator svg {
  width: 14px;
  height: 14px;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat(css): add screen share indicator styles"
```

---

### Task 4: JS — state, socket handler, endCall cleanup

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add state fields**

After `chatUnread: 0` in `public/app.js:26`, add:

```js
isScreenSharing: false,
savedCameraTrack: null,
screenStream: null,
```

- [ ] **Step 2: Add socket event handler**

After the `audio-state-change` handler in `public/app.js:169-171`, add:

```js
state.socket.on('screen-share-state-change', ({ active }) => {
  $('remote-screen-indicator').style.display = active ? 'flex' : 'none';
});
```

- [ ] **Step 3: Update endCall to clean up screen share**

In `endCall()` (`public/app.js:312-341`), after the localStream cleanup block (after line 323), add:

```js
if (state.screenStream) {
  state.screenStream.getTracks().forEach((t) => t.stop());
  state.screenStream = null;
}
state.savedCameraTrack = null;
state.isScreenSharing = false;
```

And add to the endCall reset section (after line 333):
```js
$('remote-screen-indicator').style.display = 'none';
```

- [ ] **Step 4: Run existing tests to check nothing broke**

Run: `npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(js): add screen share state, socket handler, endCall cleanup"
```

---

### Task 5: JS — implement toggleScreenShare

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add toggleScreenShare function**

Add before the `toggleMute` function (before line 478):

```js
async function toggleScreenShare() {
  if (state.isScreenSharing) {
    stopScreenShare();
  } else {
    await startScreenShare();
  }
}

async function startScreenShare() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    state.screenStream = stream;
    const screenTrack = stream.getVideoTracks()[0];

    const videoSender = state.peerConnection
      .getSenders()
      .find((s) => s.track && s.track.kind === 'video');
    if (!videoSender) {
      showNotification('Ошибка: видеотрек не найден', 'error');
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const cameraTrack = videoSender.track;
    state.savedCameraTrack = cameraTrack;

    await videoSender.replaceTrack(screenTrack);

    $('localVideo').srcObject = stream;
    state.isScreenSharing = true;
    $('btn-screen').dataset.active = 'true';

    state.socket.emit('screen-share-state-change', { active: true });

    screenTrack.onended = () => {
      stopScreenShare();
    };
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showNotification('Доступ к экрану запрещён', 'error');
    }
  }
}

function stopScreenShare() {
  if (!state.isScreenSharing) return;

  const videoSender = state.peerConnection
    .getSenders()
    .find((s) => s.track && s.track.kind === 'video');
  if (videoSender && state.savedCameraTrack) {
    videoSender.replaceTrack(state.savedCameraTrack);
  }

  if (state.screenStream) {
    state.screenStream.getTracks().forEach((t) => t.stop());
    state.screenStream = null;
  }

  $('localVideo').srcObject = state.localStream;
  state.isScreenSharing = false;
  state.savedCameraTrack = null;
  $('btn-screen').dataset.active = 'false';

  state.socket.emit('screen-share-state-change', { active: false });
}
```

- [ ] **Step 2: Wire up button click in init()**

After `$('btn-camera').addEventListener('click', toggleCamera);` (line 627), add:

```js
$('btn-screen').addEventListener('click', toggleScreenShare);
```

- [ ] **Step 3: Disable camera toggle during screen share**

In `toggleCamera()` (`public/app.js:498-508`), add early return at the top:

```js
function toggleCamera() {
  if (state.isScreenSharing) return;
  // ...existing code...
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 5: Final commit**

```bash
git add public/app.js
git commit -m "feat(js): implement screen share toggle with replaceTrack"
```
