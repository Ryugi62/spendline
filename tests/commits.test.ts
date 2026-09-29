import { describe, expect, it } from 'vitest';
import { formatCommits } from '../src/application/commits';

// J-C review: "the README lists every commit" must be literally true — docs/commits.md is generated from git log.
describe('formatCommits', () => {
  it('one row per commit, KST time, before / during the 48 h window (2026-09-28 19:00 KST)', () => {
    const md = formatCommits([
      { hash: 'aaaaaaa', unix: 1790589600 - 60, subject: 'v0.7 prep' },
      { hash: 'bbbbbbb', unix: 1790589600, subject: 'v0.8 | live' },
    ]);
    expect(md).toContain('| `aaaaaaa` | 2026-09-28 18:59 KST | before | v0.7 prep |');
    expect(md).toContain('| `bbbbbbb` | 2026-09-28 19:00 KST | during | v0.8 \\| live |');
    expect(md).toContain('2 commits · 1 before the window · 1 during');
  });
});
