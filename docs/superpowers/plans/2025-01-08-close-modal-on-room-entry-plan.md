# Auto-Closing Modal on Room Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically close the code input modal when a user successfully enters a room (creates or joins).

**Architecture:** Add a single function call to existing `enterRoom()` function to close the modal before showing the room screen. This ensures the modal is closed in both creation and join scenarios.

**Tech Stack:** Vanilla JavaScript, Socket.IO client, existing DOM manipulation functions.

---

### Task 1: Add closeModal() call to enterRoom()

**Files:**
- Modify: `public/app.js:465-485`

- [ ] **Step 1: Add closeModal() call at the start of enterRoom()**

Insert `closeModal();` as the first line of the `enterRoom(code)` function.

```javascript
function enterRoom(code) {
  closeModal(); // Закрываем модальное окно если оно открыто
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
      startWebRTC(true);
    }
    if (state.pendingOffer) {
      const sdp = state.pendingOffer;
      state.pendingOffer = null;
      handleOffer(sdp);
    }
  });
}
```

- [ ] **Step 2: Manual test - Create room**

1. Start the server: `npm start`
2. Open browser to `http://localhost:3000`
3. Click "Создать комнату"
4. Verify: No modal appears
5. Verify: Room screen shows with room code

- [ ] **Step 3: Manual test - Join room**

1. Open a second browser tab to `http://localhost:3000`
2. Click "Подключиться к комнате"
3. Enter valid room code from step 2
4. Click "Подключиться"
5. Verify: Modal closes automatically
6. Verify: Room screen shows

- [ ] **Step 4: Manual test - Room not found**

1. Click "Подключиться к комнате"
2. Enter invalid room code (e.g., "ZZZZZZ")
3. Click "Подключиться"
4. Verify: Modal remains open
5. Verify: Error message appears in modal

- [ ] **Step 5: Manual test - Room full**

1. Create a room in Tab 1
2. Join the room in Tab 2 (now room is full with 2 users)
3. In Tab 3, click "Подключиться к комнате"
4. Enter the room code
5. Click "Подключиться"
6. Verify: Modal remains open
7. Verify: Error message appears in modal

- [ ] **Step 6: Manual test - Invalid code validation**

1. Click "Подключиться к комнате"
2. Enter invalid code (e.g., "ABC" - only 3 characters)
3. Click "Подключиться"
4. Verify: Modal remains open
5. Verify: Error message "Введите 6 символов" appears

- [ ] **Step 7: Run existing tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "feat: auto-close modal on room entry"
```

---

## Self-Review Results

**Spec coverage:**
- ✅ Automatically close modal on successful room entry - Task 1, Step 1
- ✅ Works for both creation and join scenarios - Covered by `enterRoom()` being called in both cases
- ✅ Modal remains open on errors - Tested in Steps 4, 5, 6

**Placeholder scan:**
- ✅ No "TBD", "TODO", or incomplete content
- ✅ All code blocks contain actual implementation
- ✅ All test steps have exact commands and expected results

**Type consistency:**
- ✅ Function name `closeModal()` matches existing codebase
- ✅ Function name `enterRoom()` matches existing codebase
- ✅ All state references are correct

**No gaps found.**