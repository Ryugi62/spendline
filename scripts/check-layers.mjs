// Clean Architecture guard: domain imports only domain; application imports only domain/application. Exit 1 on violation.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const rules = { 'src/domain': ['./'], 'src/application': ['./', '../domain/'] };
let bad = 0;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const [dir, allowed] of Object.entries(rules)) {
  for (const f of walk(dir).filter((x) => x.endsWith('.ts'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      if (!allowed.some((a) => spec.startsWith(a))) { console.error(`LAYER ✗ ${f} imports ${spec}`); bad++; }
    }
  }
}
console.log(bad ? `layers: ${bad} violation(s)` : 'layers: OK (domain ← application ← adapters ← infrastructure)');
process.exit(bad ? 1 : 0);
