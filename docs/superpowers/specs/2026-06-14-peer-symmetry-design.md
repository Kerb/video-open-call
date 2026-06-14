# Peer Symmetry: Removing Room Creator Privilege

## Problem

Currently, the participant who creates a room is the "creator" with special status:
- Server tracks `isCreator` flag on the slot
- Client state has `isRoomCreator` controlling WebRTC initiation (`startWebRTC(true)`)
- Reconnection logic is asymmetric: creator restarts ICE, joiner closes and waits
- Different UI/behavior paths for reconnect between the two participants

Goal: Room creator should only generate the room code. After that, both participants are equal peers with identical connection and reconnection logic.

## Solution: UUID Tie-Breaker (Polite Peer Pattern)

Replace `isCreator` with deterministic offerer selection: the participant with the lexicographically smaller UUID creates the WebRTC offer; the other creates the answer.

### Server Changes

#### 1. Remove `isCreator` from Slot

`src/room-manager.js`:

```javascript
// Before
const slot = { uuid, socket, isCreator: true/false, connected: true, ... };
// After
const slot = { uuid, socket, connected: true, reconnectTimer: null, disconnectedAt: null };
```

Both `createRoom()` and `joinRoom()` produce identical slots.

#### 2. Updated events

| Event | New payload | Notes |
|-------|-------------|-------|
| `room-created` | `{ code }` | No peer yet |
| `user-joined` | `{ uuid }` | Sent to existing participant; `uuid` is the joiner's UUID |
| `room-joined` | `{ code, peerUuid }` | Includes UUID of the already-waiting participant |
| `reconnect-success` | `{ code, peerUuid, reconnectWindow }` | Replaces `isCreator` with `peerUuid` |

#### 3. `reconnectToRoom()` returns `peerUuid`

The reconnect response includes the other participant's UUID instead of `isCreator`, so both sides can independently determine their offerer/answerer role.

### Client Changes

#### 1. Remove `isRoomCreator`, add `peerUuid`

```javascript
const state = {
  // removed: isRoomCreator: false
  peerUuid: null,  // UUID of the other participant
};
```

#### 2. UUID tie-breaker function

```javascript
function shouldCreateOffer(myUuid, peerUuid) {
  return myUuid < peerUuid;
}
```

Deterministic—both sides compute the same result.

#### 3. Updated event handlers

- **`room-created`**: save `peerUuid = null`
- **`user-joined`**: `peerUuid = uuid` → `startWebRTC()` (decides offer/answer by UUID)
- **`room-joined`**: `peerUuid = data.peerUuid` → `startWebRTC()` (same logic)
- **`reconnect-success`**: `peerUuid = data.peerUuid` → same restart logic
- **`peer-reconnected`**: compute `shouldCreateOffer` → offerer: `restartIce()`, answerer: `closePeerConnection()`

#### 4. Symmetric reconnection UI

Both participants see the same:
- `DISCONNECTED` state overlay with "Retry" and "Leave" buttons
- Exponential backoff via `scheduleRetry()`
- `reconnect-room` emission on socket reconnect
- `reconnect-success` handling

### WebRTC Flow

Initial connection:
```
A: user-joined { uuid: B } → A.uuid < B.uuid? → YES → createOffer
B: room-joined { peerUuid: A } → B.uuid < A.uuid? → NO → wait for offer
```

Reconnection (same logic):
```
A: reconnect-success { peerUuid: B } → A < B → restartIce() (creates offer)
B: reconnect-success { peerUuid: A } → B >= A → closePeerConnection()
```

### Changed Files

| File | Changes |
|------|---------|
| `src/room-manager.js` | Remove `isCreator` from Slot; add `peerUuid` to reconnect response |
| `server.js` | Send `peerUuid` in `room-joined`, `reconnect-success`; update `user-joined` to include UUID |
| `public/app.js` | Remove `isRoomCreator` state; add `peerUuid`; use `shouldCreateOffer()` everywhere; symmetric reconnect handlers |

### Not Changed

- State machine transitions remain the same
- WebRTC offer/answer exchange protocol (signaling events `offer`, `answer`, `ice-candidate`)
- Chat, screen share, audio state sync
- Room creation and joining flow (except payloads)
- Reconnect timeout constants

### Testing

Existing tests for reconnection, room management, and state transitions must be updated:
- Replace `isCreator` assertions with `peerUuid` assertions
- Add tests for `shouldCreateOffer()` with UUID ordering
- Verify symmetric reconnect behavior for both participants
- Integration test: reconnect path works identically for both sides
