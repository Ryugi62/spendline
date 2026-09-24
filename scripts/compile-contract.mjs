// Compile with solc-js (no native toolchain). evmVersion london: no PUSH0 (TVM safety). Writes dist/SpendlineVault.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import solc from 'solc';
export function compile() {
  const input = {
    language: 'Solidity',
    sources: { 'SpendlineVault.sol': { content: readFileSync('contracts/SpendlineVault.sol', 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'london', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const c = out.contracts['SpendlineVault.sol'].SpendlineVault;
  return { abi: c.abi, bytecode: c.evm.bytecode.object, solc: solc.version() };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = compile();
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/SpendlineVault.json', JSON.stringify(r, null, 1));
  console.log(`compiled SpendlineVault: ${r.bytecode.length / 2} bytes, ${r.abi.length} abi entries, solc ${r.solc}`);
}
