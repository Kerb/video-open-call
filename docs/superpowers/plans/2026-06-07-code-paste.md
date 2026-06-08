# Code Paste Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 6 separate code-input fields with a single input that supports clipboard paste.

**Architecture:** Add reusable sanitization functions to `src/code.js` (testable), update the join-room modal to use a single `<input>`, update styles.

**Tech Stack:** Vanilla JS, CSS, Vitest, Node.js

---

### Task 1: Add `sanitizeCodeInput` to `src/code.js`

**Files:**
- Modify: `src/code.js`
- Test: `tests/code.test.js`

- [x] **Step 1: Write failing tests**

```js
// tests/code.test.js — add after existing `isValidCode` describe block

import { sanitizeCodeInput } from '../src/code.js';

describe('sanitizeCodeInput', () => {
  it('should convert to uppercase', () => {
    expect(sanitizeCodeInput('abc234')).toBe('ABC234');
  });

  it('should strip characters outside A-Z and 0-9', () => {
    expect(sanitizeCodeInput('AB$C@12!')).toBe('ABC12');
  });

  it('should truncate to CODE_LENGTH (6)', () => {
    expect(sanitizeCodeInput('ABCDEFGH')).toBe('ABCDEF');
  });

  it('should return empty string for empty input', () => {
    expect(sanitizeCodeInput('')).toBe('');
  });

  it('should return empty string for null/undefined', () => {
    expect(sanitizeCodeInput(null)).toBe('');
    expect(sanitizeCodeInput(undefined)).toBe('');
  });

  it('should keep valid characters', () => {
    expect(sanitizeCodeInput('ABC234')).toBe('ABC234');
  });
});
```

- [x] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/code.test.js -t "sanitizeCodeInput"`

- [x] **Step 3: Write minimal implementation**

```js
// src/code.js — add after existing exports

function sanitizeCodeInput(value) {
  if (!value) return '';
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

module.exports = { generateCode, isValidCode, sanitizeCodeInput, CODE_ALPHABET, CODE_LENGTH };
```

> **Note:** `getRawInput` was considered but ultimately not needed — the `sanitizeCodeInput` filter already strips non-alphanumeric characters (including dashes, spaces, dots). The separator stripping in `getRawInput` is redundant since `sanitizeCodeInput` handles it via the `[^A-Z0-9]` regex. The simple approach (client-side input event filter) is sufficient.

- [x] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [x] **Step 5: Commit**

```bash
git add src/code.js tests/code.test.js
git commit -m "feat: add sanitizeCodeInput for code input handling"
```

---

### Task 2: Update join-modal HTML to single input

**Files:**
- Modify: `public/index.html:31-47`

- [ ] **Step 1: Replace 6 inputs with a single input**

Replace the `.code-inputs` div in `index.html`:

Old (lines 36-43):
```html
        <div class="code-inputs">
          <input type="text" maxlength="1" class="code-input" data-index="0" inputmode="text" autocomplete="off">
          <input type="text" maxlength="1" class="code-input" data-index="1" inputmode="text" autocomplete="off">
          <input type="text" maxlength="1" class="code-input" data-index="2" inputmode="text" autocomplete="off">
          <input type="text" maxlength="1" class="code-input" data-index="3" inputmode="text" autocomplete="off">
          <input type="text" maxlength="1" class="code-input" data-index="4" inputmode="text" autocomplete="off">
          <input type="text" maxlength="1" class="code-input" data-index="5" inputmode="text" autocomplete="off">
        </div>
```

New:
```html
        <div class="code-inputs">
          <input type="text" maxlength="6" class="code-input" id="code-input" inputmode="text" autocomplete="off" placeholder="XXXXXX">
        </div>
```

- [ ] **Step 2: Run a quick visual check**

Run: Open `public/index.html` in a browser (or start the server with `npm run dev` and check the modal).

Note: The modal will look off until CSS is updated in the next task.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: replace 6 code inputs with single input field"
```

---

### Task 3: Update CSS for single input

**Files:**
- Modify: `public/style.css:199-225`

- [ ] **Step 1: Update `.code-inputs` and `.code-input` styles**

Replace the `.code-inputs` and `.code-input` block (lines 199-225):

Old:
```css
.code-inputs {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-bottom: 20px;
}

.code-input {
  width: 44px;
  height: 54px;
  text-align: center;
  font-size: 24px;
  font-weight: 700;
  font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
  letter-spacing: 2px;
  background: var(--bg);
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  outline: none;
  transition: border-color 0.2s;
  text-transform: uppercase;
}

.code-input:focus {
  border-color: var(--primary);
}
```

New:
```css
.code-inputs {
  margin-bottom: 20px;
}

.code-input {
  width: 100%;
  height: 54px;
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
  letter-spacing: 0.3em;
  background: var(--bg);
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  outline: none;
  transition: border-color 0.2s;
  text-transform: uppercase;
}

.code-input:focus {
  border-color: var(--primary);
}

.code-input::placeholder {
  font-size: 16px;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  opacity: 0.5;
}
```

Also remove responsive `.code-input` overrides in the `@media (min-width: 1024px)` and `@media (max-width: 480px)` blocks — the single input uses `width: 100%` so it adapts automatically.

In `@media (min-width: 1024px)` (around line 762), remove:
```css
  .code-input {
    width: 52px;
    height: 60px;
    font-size: 28px;
  }
```

In `@media (max-width: 480px)` (around line 821), remove:
```css
  .code-input {
    width: 38px;
    height: 48px;
    font-size: 20px;
  }
```

- [ ] **Step 2: Verify styling**

Run: `npm run dev` and open the join-modal. The single input should be full-width, with large monospace text and visible letter-spacing.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat: update code input styles for single field"
```

---

### Task 4: Update app.js for single input

**Files:**
- Modify: `public/app.js:394-490`

- [ ] **Step 1: Update `openModal` — clear and focus single input**

Remove `CODE_INPUTS`, `setupCodeInputs()`, `getCodeFromInputs()`, `clearCodeInputs()`.

Replace `openModal()`:
```js
function openModal() {
  if (!transition(STATE.JOIN_MODAL)) return;
  $('join-modal').style.display = 'flex';
  clearModalError();
  const input = $('code-input');
  input.value = '';
  input.focus();
}
```

- [ ] **Step 2: Update `handleJoinRoom` — read from single input**

```js
async function handleJoinRoom() {
  const input = $('code-input');
  const code = input.value.toUpperCase();
  if (code.length !== 6) {
    showModalError('Введите 6 символов');
    return;
  }

  clearModalError();
  $('btn-join-room').disabled = true;
  $('btn-join-room').textContent = 'Подключение...';

  state.socket.emit('join-room', { code });
}
```

- [ ] **Step 3: Add input filtering in `init()`**

Remove the `setupCodeInputs()` call from `init()`.

Add event listeners for the single input inside `init()`:
```js
  const codeInput = $('code-input');
  codeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });

  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
  });
```

- [ ] **Step 4: Verify all functionality**

Run: Start the server with `npm run dev` and test:
1. Open the join modal — single input visible, focused
2. Type characters — uppercase, filtered, limited to 6
3. Paste "abc234" — should result in "ABC234"
4. Paste "ABC-234" — should show "ABC234" (6 chars, but - is stripped, so only 6 valid chars remain)

Wait — "ABC-234" has the dash stripped, becoming "ABC234" (6 chars). That's correct for the simple filter. If we want to handle "ABC-234" we should use `getRawInput` from `src/code.js`. Let me update the approach to import it... but this is a script-tag browser app, no bundler.

Actually, `src/code.js` is a Node module (uses `module.exports`). The browser `app.js` can't import it without a bundler. So I should either:

a) Duplicate the logic in `app.js` (simple enough)
b) Inline the raw input handling: strip separators in the input event

Option (b): Keep it simple — the input filter already handles all cases. "ABC-234" → dash stripped → "ABC234" (6 chars). That's fine.

Let me reconsider: the `getRawInput` function strips separators before sanitizing. But the current simple filter strips everything non-A-Z0-9 anyway. The separator stripping in `getRawInput` actually does nothing extra compared to the simple filter. So the simple filter is sufficient.

Wait, no. The `getRawInput` strips separators and THEN calls `sanitizeCodeInput`. The `sanitizeCodeInput` strips non-A-Z0-9. So `getRawInput("ABC-234")` → "ABC234" → sanitize → "ABC234". That's the same as just sanitize directly. The `getRawInput` is actually redundant with the simple filter. But it's in the plan and tests already written... 

Actually, for the plan, let me keep the simple approach (just filter directly in the input handler). The `getRawInput` function in `src/code.js` can exist as a convenience but isn't strictly needed in the frontend.

Let me finalize the step.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: wire single code input with filtering and paste support"
```

---

### Task 5: Run full test suite & final verification

**Files:** None

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run the app and do manual smoke test**

Run: `npm run dev`
Test manually:
1. Open app → click "Подключиться к комнате" → modal opens with single input
2. Type "abc123" → see "ABC123" (uppercase, filtered)
3. Type more than 6 chars → truncated to 6
4. Paste "ABC234" from clipboard → shows "ABC234", can submit
5. Paste "abc-234" → shows "ABC234"
6. Click "Подключиться" with < 6 chars → error "Введите 6 символов"
7. Press Enter → submits
8. Close modal → re-open → input is empty and focused
