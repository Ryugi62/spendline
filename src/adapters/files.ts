import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { AnswerLog, AnswerRecord, CatalogPort, Offer } from '../application/ports';

/** Append-only JSON-lines files. Everything written here is public record (no keys, no private data). */
export class JsonlFileError extends Error {}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (!line.trim()) return;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        throw new JsonlFileError(`${path} line ${i + 1}: not valid JSON`);
      }
    });
  return out;
}
export const appendJsonl = (path: string, v: unknown) => appendFileSync(path, JSON.stringify(v) + '\n');

export class JsonlAnswerLog implements AnswerLog {
  constructor(private path: string) {}
  async all() { return readJsonl<AnswerRecord>(this.path); }
  async find(key: string) { return (await this.all()).reverse().find((a) => a.key === key); }
  async append(a: AnswerRecord) { appendJsonl(this.path, a); }
}

/** The seller catalog the agent picks from (public: addresses, prices in micro-USDT, labels). */
export class JsonCatalog implements CatalogPort {
  private list: Offer[];
  constructor(doc: { offers: Offer[] }) {
    const ok = (o: Offer) =>
      typeof o.merchant === 'string' && typeof o.item === 'string' && typeof o.label === 'string' && Number.isInteger(o.unitPrice) && o.unitPrice > 0 && Number.isInteger(o.fee) && o.fee >= 0;
    (doc.offers ?? []).forEach((o, i) => {
      if (!ok(o)) throw new JsonlFileError(`catalog offer ${i + 1}: needs merchant, item, label, unitPrice > 0 and fee >= 0 (integers, micro-USDT)`);
    });
    this.list = doc.offers;
  }
  static fromFile(path: string) { return new JsonCatalog(JSON.parse(readFileSync(path, 'utf8'))); }
  async offers(item: string) { return this.list.filter((o) => o.item === item); }
  labels(): Record<string, string> { return Object.fromEntries(this.list.map((o) => [o.merchant, o.label])); }
}
