// scripts/package.js — Bundle the extension into a distributable zip.
// Works on Windows, macOS, and Linux with no extra dependencies.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "dist");
const ZIP_NAME = "kids-guard-for-youtube.zip";

// Files and directories to include in the zip.
const INCLUDE = [
  "manifest.json",
  "background.js",
  "content.js",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
  "icons",
];

// Ensure dist/ exists.
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR);
}

const zipPath = path.join(OUT_DIR, ZIP_NAME);

// Remove old zip if present.
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Use Node's built-in zlib through a small archiver to avoid external deps.
// Node 22+ has a native zip, but we support 16+, so we roll a minimal one.

const zlib = require("zlib");

// ─── Minimal ZIP writer ──────────────────────────────────────────────

function createZip(files, outputPath) {
  const entries = [];
  const centralDir = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuffer = Buffer.from(name, "utf-8");
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data);

    // Local file header
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);         // version needed
    localHeader.writeUInt16LE(0, 6);          // flags
    localHeader.writeUInt16LE(8, 8);          // compression: deflate
    localHeader.writeUInt16LE(0, 10);         // mod time
    localHeader.writeUInt16LE(0, 12);         // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);         // extra field length

    entries.push(localHeader, nameBuffer, compressed);

    // Central directory entry
    const cdEntry = Buffer.alloc(46);
    cdEntry.writeUInt32LE(0x02014b50, 0);
    cdEntry.writeUInt16LE(20, 4);
    cdEntry.writeUInt16LE(20, 6);
    cdEntry.writeUInt16LE(0, 8);
    cdEntry.writeUInt16LE(8, 10);
    cdEntry.writeUInt16LE(0, 12);
    cdEntry.writeUInt16LE(0, 14);
    cdEntry.writeUInt32LE(crc, 16);
    cdEntry.writeUInt32LE(compressed.length, 20);
    cdEntry.writeUInt32LE(data.length, 24);
    cdEntry.writeUInt16LE(nameBuffer.length, 28);
    cdEntry.writeUInt16LE(0, 30);
    cdEntry.writeUInt16LE(0, 32);
    cdEntry.writeUInt16LE(0, 34);
    cdEntry.writeUInt16LE(0, 36);
    cdEntry.writeUInt32LE(0, 38);
    cdEntry.writeUInt32LE(offset, 42);
    centralDir.push(cdEntry, nameBuffer);

    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const cdOffset = offset;
  const cdSize = centralDir.reduce((s, b) => s + b.length, 0);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outputPath, Buffer.concat([...entries, ...centralDir, eocd]));
}

// CRC-32 (ISO 3309)
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Collect files ───────────────────────────────────────────────────

function collectFiles(basePath, items) {
  const result = [];
  for (const item of items) {
    const fullPath = path.join(basePath, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const children = fs.readdirSync(fullPath);
      for (const child of children) {
        const childPath = path.join(fullPath, child);
        if (fs.statSync(childPath).isFile()) {
          result.push({
            name: path.posix.join(item, child),
            data: fs.readFileSync(childPath),
          });
        }
      }
    } else {
      result.push({ name: item, data: fs.readFileSync(fullPath) });
    }
  }
  return result;
}

const files = collectFiles(ROOT, INCLUDE);
createZip(files, zipPath);

console.log(`\n  Packaged ${files.length} files → dist/${ZIP_NAME}\n`);
console.log("  To install:");
console.log("  1. Open chrome://extensions");
console.log("  2. Enable Developer mode");
console.log(`  3. Drag-and-drop dist/${ZIP_NAME} onto the page, or`);
console.log('     click "Load unpacked" and select the extracted folder\n');
