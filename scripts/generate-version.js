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
