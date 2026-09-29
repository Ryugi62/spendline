// usage: npm run commits → docs/commits.md (every commit, oldest first, with its time and window side)
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { formatCommits } from '../src/application/commits';

const log = execSync("git log --reverse --format='%h%x09%ct%x09%s'").toString().trim().split('\n');
const cs = log.map((l) => { const [hash, t, ...s] = l.split('\t'); return { hash, unix: Number(t), subject: s.join('\t') }; });
writeFileSync('docs/commits.md', formatCommits(cs));
console.log(`docs/commits.md: ${cs.length} commits`);
