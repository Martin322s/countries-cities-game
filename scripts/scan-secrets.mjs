#!/usr/bin/env node
/**
 * Secret scanner (no dependencies): fails when something that looks like a private
 * credential is present in tracked source, tests, docs, config — or in the built bundle.
 *
 *   node scripts/scan-secrets.mjs          # repository
 *   node scripts/scan-secrets.mjs dist     # also the production build output
 *
 * Public values are allowed: the publishable/anon key and project URL are designed to
 * be shipped to browsers. Local-development defaults printed by `supabase start` are
 * well-known demo values and are allowed only in local test tooling.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', '.temp', 'supabase/.temp']);
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|sql|toml|yml|yaml|env|html|css|txt|example)$|^\.env/;

const RULES = [
  { name: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: 'Supabase personal access token', re: /\bsbp_[A-Za-z0-9]{30,}/ },
  { name: 'service_role JWT', re: /eyJ[\w-]{10,}\.(eyJ[\w-]*?c2VydmljZV9yb2xl[\w-]*)\.[\w-]{10,}/ },
  {
    name: 'Postgres URL with password',
    re: /postgres(?:ql)?:\/\/[^\s:@/]+:(?!postgres@)[^\s@/]{6,}@/,
  },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: 'Generic secret assignment',
    re: /\b(?:SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|DB_PASSWORD|JWT_SECRET)\s*=\s*['"]?[A-Za-z0-9_\-./+]{16,}/,
  },
];

/** Placeholders / documentation examples that are not secrets. */
const ALLOW = [/your-|<[^>]+>|\.\.\.|example|placeholder|xxxx/i];

const findings = [];
function scan(file) {
  const text = fs.readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    for (const rule of RULES) {
      const match = line.match(rule.re);
      if (match && !ALLOW.some((allow) => allow.test(match[0]))) {
        findings.push(`${path.relative(process.cwd(), file)}:${String(index + 1)}  ${rule.name}`);
      }
    }
  });
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !SKIP_DIRS.has(rel)) walk(full);
    } else if (
      !SKIP_FILES.has(entry.name) &&
      (TEXT.test(entry.name) || rel.startsWith('assets/'))
    ) {
      scan(full);
    }
  }
}

walk(root);
if (findings.length > 0) {
  console.error(`Possible secrets found (${String(findings.length)}):\n${findings.join('\n')}`);
  process.exit(1);
}
console.log(`No secrets found in ${path.relative(process.cwd(), root) || '.'}`);
