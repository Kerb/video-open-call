# Screen Share Feature — Design Spec

## 1. Overview

Add a screen share button to the video call control bar. When activated, the user's screen/desktop is broadcast instead of the camera feed. The camera remains physically active but its video track is replaced in the RTCPeerConnection.

## 2. Button Placement & UI

| Aspect | Decision |
|--------|----------|
| Position | Between Camera and Chat buttons in the control bar |
| Icon | Monitor/screen SVG (monitor icon) |
| Active state | `data-active="true"` — blue highlight (matching other control buttons) |
| Inactive state | Default semi-transparent control button |
| Remote indicator | Badge `📺 Screen` on remote video container (similar to `remote-mute-indicator`) |

### Camera toggle interaction

When screen sharing is active, the Camera button is visually disabled (`data-active="false"`) and clicks are ignored. The physical camera may remain active (browser-dependent), but the button indicates that camera control is unavailable during screen share.

## 3. State & Data

New properties in the client state object (`app.js`):

```js
isScreenSharing: false,      // is screen sharing active
savedCameraTrack: null,      // original camera video track (MediaStreamTrack)
screenStream: null,          // display capture stream (for cleanup)
```

No new state machine node — screen sharing is a sub-state within `IN_CALL`.

## 4. Socket Events

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `screen-share-state-change` | `{ active: boolean }` | Remote peer toggled screen share |

### Implementation (server.js)

Simple relay, identical to `audio-state-change`:

```js
socket.on('screen-share-state-change', ({ active }) => {
  if (!socket.currentRoom) return;
  socket.to(socket.currentRoom).emit('screen-share-state-change', { active });
});
```

## 5. Screen Share Flow

### Start screen share

1. User clicks Screen Share button
2. Call `navigator.mediaDevices.getDisplayMedia({ video: true })`
3. Save screen stream → `state.screenStream`
4. Get the screen's video track via `screenStream.getVideoTracks()[0]`
5. Save current camera video track → `state.savedCameraTrack`
6. Find video sender: `pc.getSenders().find(s => s.track?.kind === 'video')`
7. Call `sender.replaceTrack(screenTrack)`
8. Update local preview: `$('localVideo').srcObject = state.screenStream`
9. Set `state.isScreenSharing = true`, update button `data-active`
10. Emit `socket.emit('screen-share-state-change', { active: true })`
11. Attach `screenTrack.onended` handler (browser's native stop-sharing stops our flow)

### Stop screen share

1. User clicks Screen Share button again (or browser's stop-sharing)
2. Call `sender.replaceTrack(state.savedCameraTrack)`
3. Stop all screen tracks: `state.screenStream.getTracks().forEach(t => t.stop())`
4. Restore local preview: `localVideo.srcObject = state.localStream`
5. Clear: `isScreenSharing = false`, `screenStream = null`, `savedCameraTrack = null`
6. Update button state
7. Emit `socket.emit('screen-share-state-change', { active: false })`

### Browser native stop handling

The screen track fires `onended` when the user clicks the browser's "Stop sharing" button. This handler must call the same stop logic to keep state consistent.

### Error handling

| Condition | Action |
|-----------|--------|
| `getDisplayMedia` → `NotAllowedError` | Show notification "Доступ к экрану запрещён" |
| User cancels selection | `NotAllowedError`/`AbortError` → silent ignore (no notification) |

## 6. Edge Cases

### Hangup during screen share

The existing `endCall()` function must be extended:

```js
function endCall() {
  // ...existing cleanup...
  if (state.screenStream) {
    state.screenStream.getTracks().forEach(t => t.stop());
    state.screenStream = null;
  }
  state.savedCameraTrack = null;
  state.isScreenSharing = false;
}
```

### Remote receives screen share

The client handles `screen-share-state-change` events to toggle a visual badge on the remote video container (`remote-screen-indicator`).

### Camera toggle disabled

While `isScreenSharing === true`, the `toggleCamera()` function returns early (no-op). The button's visual state stays `data-active="false"`.

### Track restoration

When stopping screen share, the original camera track is restored via `replaceTrack`. The camera track's `enabled` state is preserved — if the user had disabled the camera before sharing, it returns disabled.

## 7. Files Changed

| File | Changes |
|------|---------|
| `public/index.html` | Add screen share button HTML + remote screen indicator badge |
| `public/style.css` | Add styles for new button and indicator |
| `public/app.js` | Add state fields, socket handler, button handler, replaceTrack logic, endCall update |
| `server.js` | Add `screen-share-state-change` relay event |

## 8. Non-Goals

- System audio capture (not included — user confirmed no)
- Dual-stream (screen + camera simultaneously)
- Screen share recording
- TURN relay for screen share (same ICE as video call)
- Any new server-side room state
