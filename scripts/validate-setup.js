// scripts/validate-setup.js — Cross-platform setup validation.
// Checks that all required files, tools, and configuration are in place.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let ok = true;

function check(label, pass, hint) {
  if (pass) {
    console.log(`  ✓  ${label}`);
  } else {
    console.log(`  ✗  ${label}`);
    if (hint) console.log(`     → ${hint}`);
    ok = false;
  }
}

console.log("\n  YouTube Kids Guard — setup validation\n");

// 1. Required extension files
const requiredFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

for (const file of requiredFiles) {
  check(file, fs.existsSync(path.join(ROOT, file)), `Missing file: ${file}`);
}

// 2. manifest.json is valid JSON and has required fields
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "manifest.json"), "utf-8")
  );
  check("manifest.json is valid JSON", true);
  check(
    "manifest_version is 3",
    manifest.manifest_version === 3,
    "This extension requires Manifest V3."
  );
  check(
    "background.service_worker is set",
    manifest.background?.service_worker === "background.js"
  );
  check(
    "content_scripts defined",
    Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0
  );
} catch (e) {
  check("manifest.json is valid JSON", false, e.message);
}

// 3. node_modules installed
check(
  "node_modules installed",
  fs.existsSync(path.join(ROOT, "node_modules")),
  'Run "npm install" first.'
);

// 4. Jest available
try {
  require.resolve("jest");
  check("jest is available", true);
} catch {
  check("jest is available", false, 'Run "npm install" to install dev dependencies.');
}

// 5. Node version
const [major] = process.versions.node.split(".").map(Number);
check(
  `Node.js v${process.versions.node} (>=16 required)`,
  major >= 16,
  "Please install Node.js 16 or later: https://nodejs.org"
);

console.log("");

if (ok) {
  console.log("  All checks passed. Ready to load in Chrome!\n");
  console.log("  Next steps:");
  console.log("  1. Open chrome://extensions");
  console.log("  2. Enable Developer mode");
  console.log('  3. Click "Load unpacked" and select this folder');
  console.log("  4. Right-click the extension icon → Options → pick an AI provider");
  console.log("     (Gemini, OpenAI, Anthropic or OpenRouter) and enter its API key\n");
} else {
  console.log("  Some checks failed. Fix the issues above and re-run: npm run setup\n");
  process.exit(1);
}
