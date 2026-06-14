# Version Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display app version `YYYY.MM.DD.NNNN` in home screen footer

**Architecture:** Node.js script at startup reads git commit count, generates `public/version.json`, client fetches and renders it

**Tech Stack:** Node.js, vanilla JS, Express static files

---

### Task 1: Create version generation script

**Files:**
- Create: `scripts/generate-version.js`

- [ ] **Step 1: Create `scripts/generate-version.js`**

```javascript
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function generateVersion() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}.${m}.${d}`;

  let buildNumber = 1;
  try {
    const count = execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim();
    buildNumber = parseInt(count, 10);
    if (isNaN(buildNumber) || buildNumber < 1) buildNumber = 1;
  } catch {
    // git not available — use fallback
  }

  const version = `${dateStr}.${String(buildNumber).padStart(4, '0')}`;

  const outputDir = path.join(__dirname, '..', 'public');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(outputDir, 'version.json'),
    JSON.stringify({ version, date: dateStr, buildNumber }, null, 2)
  );
}

generateVersion();
```

- [ ] **Step 2: Verify script runs without errors**

Run: `node scripts/generate-version.js`
Expected: exits silently, creates `public/version.json` with content like `{"version":"2026.06.14.0042","date":"2026.06.14","buildNumber":42}`

---

### Task 2: Wire up prestart/predev in package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add prestart and predev scripts**

Edit `package.json` scripts section:

```json
"scripts": {
  "prestart": "node scripts/generate-version.js",
  "predev": "node scripts/generate-version.js",
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 2: Verify `npm start` runs the prestart script**

Run: `rm public/version.json && npm start` (Ctrl+C after it starts)
Expected: `public/version.json` is recreated before server starts

---

### Task 3: Add footer element to home screen

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add footer inside `#home-screen`**

After line 29 (`</div>` closing `.home-content`), add:

```html
      <footer class="app-footer" id="app-version"></footer>
```

The exact insertion point: after the `</div>` that closes `.home-buttons` (line 28), before `</div>` that closes `.home-content` (line 29), OR after `.home-content` but inside `#home-screen`. Looking at the structure:

```html
<div id="home-screen" class="screen">
  <div class="home-content">
    ...
    <div class="home-buttons">
      ...
    </div>          <!-- line 28 -->
  </div>            <!-- line 29 -->
</div>              <!-- line 30 -->
```

Insert the footer after `</div>` (line 29, closing `.home-content`) and before `</div>` (line 30, closing `#home-screen`):

```html
      <footer class="app-footer" id="app-version"></footer>
    </div>
```

---

### Task 4: Add footer CSS styles

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add `.app-footer` styles**

After the `.home-content` block (around line 91), add:

```css
.app-footer {
  position: absolute;
  bottom: 8px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  user-select: none;
  pointer-events: none;
}
```

Also need `#home-screen` to have `position: relative` for absolute positioning to work. It already has `position: static` by default in flex layout. Check — `#home-screen` is a flex container but doesn't have explicit `position`. Let's add it:

Add to `#home-screen` rule (line 54-58):

```css
#home-screen {
  align-items: center;
  justify-content: center;
  padding: 24px;
  position: relative;
}
```

---

### Task 5: Fetch version in app.js

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add fetchVersion function and call it**

Add after line 42 (`console.log(...)`) or at the end of the `init()` function, before the closing `}`:

```javascript
function loadVersion() {
  fetch('/version.json')
    .then(r => r.json())
    .then(data => {
      const el = document.getElementById('app-version');
      if (el) el.textContent = data.version;
    })
    .catch(() => {});
}
```

Call it at the end of the `init()` function (after line 961):

```javascript
  loadVersion();
```

---

### Task 6: Verify end-to-end

- [ ] **Step 1: Run the full flow**

```bash
git add -A && git commit -m "feat: add version footer to home screen"
npm start
```

Expected:
- Server starts
- `public/version.json` exists with version
- Open http://localhost:3000 → footer at bottom of home screen shows `2026.06.14.0042`

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: all existing tests pass (no functional changes)
