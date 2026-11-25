import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const FORBIDDEN_DASH_PATTERN = /[\u2013\u2014]/;
const AI_COMMENT_WORDS = ['Generated' + ' by', 'Chat' + 'GPT', 'Clau' + 'de', 'Copi' + 'lot', 'lucide-'];

const JS_FILES = [
  'api/vpn.js',
  'dev-server.mjs',
  'scripts/validate.mjs',
  'tests/vpn.test.mjs'
];

function collectProjectFiles(dirPath, acc = []) {
  for (const name of readdirSync(dirPath)) {
    if (name === 'node_modules' || name === '.git' || name === '.vercel') continue;
    const fullPath = join(dirPath, name);
    if (statSync(fullPath).isDirectory()) {
      collectProjectFiles(fullPath, acc);
    } else {
      acc.push(fullPath);
    }
  }
  return acc;
}

function linearizeChannel(hexByte) {
  const srgb = hexByte / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hexColor) {
  const clean = hexColor.replace('#', '').trim();
  const r = linearizeChannel(Number.parseInt(clean.slice(0, 2), 16));
  const g = linearizeChannel(Number.parseInt(clean.slice(2, 4), 16));
  const b = linearizeChannel(Number.parseInt(clean.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function computeContrastRatio(fgHex, bgHex) {
  const lumA = relativeLuminance(fgHex);
  const lumB = relativeLuminance(bgHex);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

function extractCssThemeTokens(cssBlock) {
  const tokens = {};
  const propRegex = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  let match = propRegex.exec(cssBlock);
  while (match) {
    tokens[match[1]] = match[2].toUpperCase();
    match = propRegex.exec(cssBlock);
  }
  return tokens;
}

function verifyJsSyntax(failures) {
  for (const relPath of JS_FILES) {
    try {
      execFileSync(process.execPath, ['--check', join(ROOT_DIR, relPath)], { stdio: 'pipe' });
    } catch (err) {
      failures.push(`Syntax error in ${relPath}: ${err.message}`);
    }
  }
}

function verifyTextHygiene(allFiles, failures) {
  const allowedExts = new Set(['.html', '.js', '.mjs', '.svg', '.json', '.md', '.example', '']);
  for (const filePath of allFiles) {
    const relPath = relative(ROOT_DIR, filePath);
    const ext = extname(filePath);
    if (!allowedExts.has(ext) && !relPath.endsWith('.gitignore')) continue;

    const text = readFileSync(filePath, 'utf8');
    if (EMOJI_PATTERN.test(text)) failures.push(`Forbidden emoji detected in ${relPath}`);
    if (FORBIDDEN_DASH_PATTERN.test(text)) failures.push(`Forbidden dash detected in ${relPath}`);

    if (relPath !== 'scripts/validate.mjs' && (ext === '.html' || ext === '.js' || ext === '.mjs' || ext === '.svg')) {
      for (const marker of AI_COMMENT_WORDS) {
        if (text.toLowerCase().includes(marker.toLowerCase())) {
          failures.push(`Forbidden tool fingerprint "${marker}" in ${relPath}`);
        }
      }
    }
  }
}

function verifyHtmlMarkup(html, failures) {
  if (!/<html[^>]*\blang="id"/i.test(html)) failures.push('Missing <html lang="id">');
  if (!/<title>[^<]+<\/title>/i.test(html)) failures.push('Missing non-empty <title>');
  if (!/<meta\s+name="generator"\s+content="Build by konoha"\s*>/i.test(html)) {
    failures.push('Missing <meta name="generator" content="Build by konoha">');
  }
  if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/i.test(html)) {
    failures.push('Viewport must not disable zoom');
  }

  const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/i);
  if (!footerMatch || !footerMatch[0].includes('Build by konoha')) {
    failures.push('Footer missing exact visible text "Build by konoha"');
  }

  for (const tag of ['<header', '<nav', '<main', '<footer']) {
    if (!html.includes(tag)) failures.push(`Missing landmark ${tag}>`);
  }

  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  if (levels.filter((n) => n === 1).length !== 1) failures.push('Document must have exactly one <h1>');
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] > levels[i - 1] + 1) {
      failures.push(`Skipped heading level: h${levels[i - 1]} to h${levels[i]}`);
    }
  }

  for (const rule of ['cursor: pointer', 'cursor: not-allowed', ':focus-visible', 'prefers-reduced-motion: reduce']) {
    if (!html.includes(rule)) failures.push(`Missing CSS rule: ${rule}`);
  }

  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) {
    failures.push('Missing inline client <script>');
    return;
  }
  try {
    new vm.Script(scriptMatch[1], { filename: 'index.html#inline-script' });
  } catch (err) {
    failures.push(`Inline script syntax error: ${err.message}`);
  }
}

function verifyThemeContrast(html, failures) {
  const lightMatch = html.match(/\[data-theme="light"\]\s*\{([\s\S]*?)\}/);
  const darkMatch = html.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);
  if (!lightMatch || !darkMatch) {
    failures.push('Missing light or dark theme CSS token block');
    return 0;
  }
  const light = extractCssThemeTokens(lightMatch[1]);
  const dark = extractCssThemeTokens(darkMatch[1]);

  const pairs = [
    ['Light primary/surface', light['--text-primary'], light['--bg-surface'], 4.5],
    ['Light primary/canvas', light['--text-primary'], light['--bg-canvas'], 4.5],
    ['Light secondary/surface', light['--text-secondary'], light['--bg-surface'], 4.5],
    ['Light secondary/subtle', light['--text-secondary'], light['--bg-subtle'], 4.5],
    ['Light CTA', light['--btn-primary-text'], light['--accent-primary'], 4.5],
    ['Light crimson/surface', light['--accent-crimson'], light['--bg-surface'], 4.5],
    ['Light control border', light['--border-control'], light['--bg-surface'], 3.0],
    ['Dark primary/surface', dark['--text-primary'], dark['--bg-surface'], 4.5],
    ['Dark primary/canvas', dark['--text-primary'], dark['--bg-canvas'], 4.5],
    ['Dark secondary/surface', dark['--text-secondary'], dark['--bg-surface'], 4.5],
    ['Dark secondary/subtle', dark['--text-secondary'], dark['--bg-subtle'], 4.5],
    ['Dark CTA', dark['--btn-primary-text'], dark['--accent-primary'], 4.5],
    ['Dark crimson/surface', dark['--accent-crimson'], dark['--bg-surface'], 4.5],
    ['Dark control border', dark['--border-control'], dark['--bg-surface'], 3.0]
  ];

  for (const [name, fg, bg, min] of pairs) {
    if (!fg || !bg) {
      failures.push(`Missing token for ${name}`);
      continue;
    }
    const ratio = computeContrastRatio(fg, bg);
    if (ratio < min) failures.push(`Contrast failure ${name}: ${ratio}:1 < ${min}:1`);
  }
  return pairs.length;
}

function main() {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode=')) || '--mode=lint';
  const mode = modeArg.split('=')[1] || 'lint';
  const failures = [];

  const allFiles = collectProjectFiles(ROOT_DIR);
  verifyJsSyntax(failures);
  verifyTextHygiene(allFiles, failures);

  const html = readFileSync(join(ROOT_DIR, 'index.html'), 'utf8');
  verifyHtmlMarkup(html, failures);
  const pairCount = verifyThemeContrast(html, failures);

  if (failures.length > 0) {
    process.stderr.write(`[${mode.toUpperCase()} FAILED] ${failures.length} issue(s):\n`);
    for (const msg of failures) process.stderr.write(` - ${msg}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `[${mode.toUpperCase()} OK] Verified ${allFiles.length} files, syntax, landmarks, zero emojis/dashes, and ${pairCount} WCAG AA pairings.\n`
  );
}

main();
