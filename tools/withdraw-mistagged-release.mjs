#!/usr/bin/env node
// One-time cleanup of the release created during this change, not its historic tag.
import { readFileSync } from 'node:fs';
if (readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim() !== '0.5.0') process.exit(0);
const repo = 'reactnativecn/react-native-update-skill';
if (process.env.GITHUB_REPOSITORY !== repo || !process.env.GH_TOKEN) throw new Error('Expected authorized release workflow');
const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN}` };
const endpoint = `https://api.github.com/repos/${repo}/releases/397651452`;
const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15000) });
if (response.status === 404) process.exit(0);
if (!response.ok) throw new Error(`Cleanup lookup failed: ${response.status}`);
const release = await response.json();
if (release.tag_name !== 'v0.4.0' || release.target_commitish !== '1ebc2c18c635d8e4ec6ef8799a3f43e90a74e0cc'
    || release.author?.login !== 'github-actions[bot]'
    || !release.assets?.some((asset) => asset.name === 'react-native-update.skill'
      && asset.digest === 'sha256:6e32ca00f73865176cdb3593fb4a31567e3e1b07c204b40dad1ad6da1931370e')) {
  throw new Error('Release identity changed; refusing cleanup');
}
const removed = await fetch(endpoint, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) });
if (!removed.ok) throw new Error(`Cleanup failed: ${removed.status}`);
console.log("Removed this change's mistaken v0.4.0 Release; historic Git tag is unchanged.");
