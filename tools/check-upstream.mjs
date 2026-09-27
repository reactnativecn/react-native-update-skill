#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';
const baseline = JSON.parse(readFileSync(new URL('../upstream-versions.json', import.meta.url), 'utf8'));
const lines = [`## Upstream reference check (reviewed ${baseline.reviewedAt})`, ''];
let changed = false;
for (const [repo, expected] of Object.entries(baseline.repositories)) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Release lookup failed for ${repo}: HTTP ${response.status}`);
  const release = await response.json();
  if (typeof release.tag_name !== 'string' || release.draft || release.prerelease) throw new Error(`Invalid stable release response for ${repo}`);
  const differs = release.tag_name !== expected;
  changed ||= differs;
  lines.push(`- ${repo}: reviewed ${expected}; latest ${release.tag_name}${differs ? ' — guide review required' : ' — unchanged'}`);
}
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
process.exitCode = changed ? 2 : 0;
