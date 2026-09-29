import { describe, expect, it } from 'vitest';
import { entryFromKilnResponse, findWitness, type JournalEntry } from '../src/domain/kilnJournal';
import { proxyChat } from '../src/application/kilnProxy';

// AC-45: a Kiln pass-through so an UNMODIFIED agent host gets the Kiln witness — the proxy journals each Kiln reply (generation id,
// usage, the tool calls it asked for); the MCP server binds a spendline_pay to the Kiln reply whose tool call carries exactly its arguments.
const reply = (calls: { name: string; arguments: string }[], text = '') => ({
  choices: [{ message: { content: text, tool_calls: calls.map((c, i) => ({ id: `call_${i}`, type: 'function', function: c })) } }],
  usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.0001 },
});

describe('entryFromKilnResponse', () => {
  it('keeps the generation id, the usage and every tool call — proper, or written into the text', () => {
    const e = entryFromKilnResponse(reply([{ name: 'spendline_pay', arguments: '{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"eval"}' }]), { generationId: 'g1', latencyMs: 1500, serverMs: 800, at: 1000 });
    expect(e).toMatchObject({ generationId: 'g1', at: 1000, usage: { flow: 'F4_mcp_host', promptTokens: 900, completionTokens: 120, costUsd: 0.0001, latencyMs: 1500, serverMs: 800, generationId: 'g1' } });
    expect(e.toolCalls).toEqual([{ name: 'spendline_pay', arguments: '{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"eval"}', via: 'tool_call' }]);
    const leaked = entryFromKilnResponse(reply([], '{"name": "spendline_pay", "arguments": {"to": "Kiln credits", "why": "x"}}'), { generationId: 'g2', latencyMs: 1, at: 1 });
    expect(leaked.toolCalls).toEqual([{ name: 'spendline_pay', arguments: '{"to":"Kiln credits","why":"x"}', via: 'tool_call_in_text' }]);
  });
});

describe('findWitness', () => {
  const entries: JournalEntry[] = [
    entryFromKilnResponse(reply([{ name: 'spendline_pay', arguments: '{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"eval"}' }, { name: 'spendline_pay', arguments: '{"to":"Kiln credits","why":"eval"}' }]), { generationId: 'g-new', latencyMs: 1, at: 100_000 }),
    entryFromKilnResponse(reply([{ name: 'spendline_pay', arguments: '{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"eval"}' }]), { generationId: 'g-old', latencyMs: 1, at: 10_000 }),
  ];
  it('binds a pay call to the newest Kiln reply (within 120 s) whose tool call has exactly these arguments — key order does not matter', () => {
    const w = findWitness(entries, { name: 'spendline_pay', args: { why: 'eval', quantity: 1, item: 'gpu-hours', to: 'GPU Shop' } }, { now: 101_000, used: new Set() });
    expect(w).toMatchObject({ generationId: 'g-new', args: '{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"eval"}', via: 'tool_call', flow: 'F4_mcp_host' });
  });
  it('no witness for arguments no Kiln reply asked for, for a reply older than the window, or for a call already bound', () => {
    expect(findWitness(entries, { name: 'spendline_pay', args: { to: 'GPU Shop', item: 'gpu-hours', quantity: 2, why: 'eval' } }, { now: 101_000, used: new Set() })).toBeUndefined();
    expect(findWitness(entries, { name: 'spendline_pay', args: { to: 'Kiln credits', why: 'eval' } }, { now: 300_000, used: new Set() })).toBeUndefined();
    const used = new Set(['g-new#1']);
    expect(findWitness(entries, { name: 'spendline_pay', args: { to: 'Kiln credits', why: 'eval' } }, { now: 101_000, used })).toBeUndefined();
  });
});

describe('proxyChat (the Kiln pass-through)', () => {
  it('forwards to Kiln with the Kiln key (the host sends any key), journals the reply, returns it unchanged with the generation id header', async () => {
    const seen: { url: string; auth: string | null; body: string }[] = [];
    const upstream = async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get('authorization'), body: String(init.body) });
      return new Response(JSON.stringify(reply([{ name: 'spendline_pay', arguments: '{"to":"GPU Shop"}' }])), { status: 200, headers: { 'content-type': 'application/json', 'x-neocloud-generation-id': 'gen-7', 'x-envoy-upstream-service-time': '640' } });
    };
    const journal: JournalEntry[] = [];
    const out = await proxyChat({ body: '{"model":"qwen3-32b","messages":[]}', kiln: { baseUrl: 'https://kiln.example/v1', apiKey: 'KILN' }, fetchImpl: upstream as typeof fetch, record: async (e) => { journal.push(e); }, now: () => 5_000 });
    expect(seen).toEqual([{ url: 'https://kiln.example/v1/chat/completions', auth: 'Bearer KILN', body: '{"model":"qwen3-32b","messages":[]}' }]);
    expect(out.status).toBe(200);
    expect(out.headers['x-neocloud-generation-id']).toBe('gen-7');
    expect(JSON.parse(out.body).choices[0].message.tool_calls[0].function.name).toBe('spendline_pay');
    expect(journal).toEqual([expect.objectContaining({ generationId: 'gen-7', at: 5_000, toolCalls: [{ name: 'spendline_pay', arguments: '{"to":"GPU Shop"}', via: 'tool_call' }] })]);
    expect(journal[0].usage.serverMs).toBe(640);
  });
  it('a streamed request is passed through and not journaled (said in the reply header)', async () => {
    const upstream = async () => new Response('data: {}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const journal: JournalEntry[] = [];
    const out = await proxyChat({ body: '{"stream":true}', kiln: { baseUrl: 'https://k/v1', apiKey: 'K' }, fetchImpl: upstream as unknown as typeof fetch, record: async (e) => { journal.push(e); }, now: () => 1 });
    expect(out.headers['x-spendline-witness']).toBe('not recorded: streamed');
    expect(journal).toEqual([]);
  });
});

describe('round-4 review: the journal carries who asked, which conversation, and a hash of Kiln\'s reply', () => {
  const body = (msgs: { role: string; content: string }[]) => JSON.stringify({ model: 'qwen3-32b', messages: msgs });
  const sys = { role: 'system', content: 'You buy compute.' };
  const ask = { role: 'user', content: 'Buy 1 GPU hour, as cheap as you can' };
  it('proxyChat journals the person\'s request (the last user turn), the conversation it belongs to, and sha256 of the reply body', async () => {
    const journal: JournalEntry[] = [];
    const upstream = async () => new Response(JSON.stringify(reply([{ name: 'spendline_pay', arguments: '{"to":"GPU Shop"}' }])), { status: 200, headers: { 'x-neocloud-generation-id': 'g1' } });
    const deps = { kiln: { baseUrl: 'https://k/v1', apiKey: 'K' }, fetchImpl: upstream as unknown as typeof fetch, record: async (e: JournalEntry) => { journal.push(e); }, now: () => 1, hash: (s: string) => `h(${s.length})` };
    await proxyChat({ ...deps, body: body([sys, ask]) });
    await proxyChat({ ...deps, body: body([sys, ask, { role: 'assistant', content: '' }, { role: 'tool', content: '{}' }]) });
    expect(journal.map((e) => [e.asked, e.conversationStart])).toEqual([[ask.content, true], [ask.content, false]]);
    expect(journal[0].bodySha256).toMatch(/^h\(\d+\)$/);
    expect(journal[0].conversationKey).toBe(journal[1].conversationKey);
  });
  it('--no-think: the pass-through adds Qwen3\'s /no_think to the last user turn and says so in the journal', async () => {
    const sent: string[] = [];
    const upstream = async (_u: string, init: RequestInit) => { sent.push(String(init.body)); return new Response(JSON.stringify(reply([])), { status: 200, headers: { 'x-neocloud-generation-id': 'g2' } }); };
    const journal: JournalEntry[] = [];
    await proxyChat({ body: body([sys, ask]), kiln: { baseUrl: 'https://k/v1', apiKey: 'K' }, fetchImpl: upstream as unknown as typeof fetch, record: async (e) => { journal.push(e); }, now: () => 1, hash: (s) => s, noThink: true });
    expect(JSON.parse(sent[0]).messages[1].content).toBe('Buy 1 GPU hour, as cheap as you can /no_think');
    expect(journal[0].noThink).toBe(true);
    expect(journal[0].asked).toBe(ask.content);
  });
});

describe('round-4 review: conversation instances and occurrence from the journal', () => {
  const e = (gen: string, start: boolean, calls: string[], at: number): JournalEntry => ({ ...entryFromKilnResponse(reply(calls.map((a) => ({ name: 'spendline_pay', arguments: a }))), { generationId: gen, latencyMs: 1, at }), conversationKey: 'K', conversationStart: start, asked: 'Two credits' });
  const one = '{"to":"Kiln credits","why":"eval"}';
  it('occurrence counts identical calls inside one Kiln reply; a later reply re-asking starts at 0 (a retry), and a new conversation (the request sent again) starts at 0', () => {
    const entries = [e('a', true, [one, one], 1000), e('b', false, [one], 2000), e('c', true, [one], 3000)];
    const w = (key: string) => findWitness(entries, { name: 'spendline_pay', args: JSON.parse(one) }, { now: 4000, used: new Set(key ? key.split(',') : []) });
    expect(w('')).toMatchObject({ generationId: 'c', occurrence: 0, asked: 'Two credits', conversation: 'c' });
    expect(w('c#0')).toMatchObject({ generationId: 'b', occurrence: 0, conversation: 'a' }); // round-6: a later reply re-asking is a retry
    expect(w('c#0,b#0')).toMatchObject({ generationId: 'a', occurrence: 0, conversation: 'a' });
    expect(w('c#0,b#0,a#0')).toMatchObject({ generationId: 'a', occurrence: 1, conversation: 'a' });
  });
});

describe('round-4 review: the published journal is checked against the receipts', () => {
  it('each receipt bound by the pass-through has its (generation, arguments) in the journal byte for byte; a mismatch is named', async () => {
    const { journalCheck } = await import('../src/domain/kilnJournal');
    const j = [entryFromKilnResponse(reply([{ name: 'spendline_pay', arguments: '{"to":"GPU Shop"}' }]), { generationId: 'g1', latencyMs: 1, at: 1 })];
    const r = (seq: number, gen: string, args: string) => ({ seq, flows: [{ flow: 'F4_mcp_host' as const, promptTokens: 1, completionTokens: 1, costUsd: 0, latencyMs: 1, generationId: gen, args }] });
    expect(journalCheck([r(1, 'g1', '{"to":"GPU Shop"}'), r(2, 'g9', '{"to":"x"}')] as never, j)).toEqual({ inJournal: 1, checked: 1, mismatches: [] });
    expect(journalCheck([r(1, 'g1', '{"to":"Kiln credits"}')] as never, j)).toEqual({ inJournal: 0, checked: 1, mismatches: ['#1: the journal has no such call for g1'] });
  });
});

describe('round-5 review', () => {
  const r = (calls: string[]) => reply(calls.map((a) => ({ name: 'spendline_pay', arguments: a })));
  it('occurrence counts the same item (seller, item, quantity) whatever the model wrote as `why` — two GPU hours for two jobs are two purchases', () => {
    const e: JournalEntry = { ...entryFromKilnResponse(r(['{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"for the eval"}', '{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"for training"}']), { generationId: 'g', latencyMs: 1, at: 1000 }), conversationKey: 'K', conversationStart: true };
    const first = findWitness([e], { name: 'spendline_pay', args: { to: 'GPU Shop', item: 'gpu-hours', quantity: 1, why: 'for the eval' } }, { now: 2000, used: new Set() });
    const second = findWitness([e], { name: 'spendline_pay', args: { to: 'GPU Shop', item: 'gpu-hours', quantity: 1, why: 'for training' } }, { now: 2000, used: new Set([first!.key]) });
    expect([first?.occurrence, second?.occurrence]).toEqual([0, 1]);
  });
  it('the person\'s request is the LAST user turn, and a new user turn in the same chat opens a new conversation instance', async () => {
    const journal: JournalEntry[] = [];
    const upstream = async () => new Response(JSON.stringify(r([])), { status: 200, headers: { 'x-neocloud-generation-id': 'g' } });
    const deps = { kiln: { baseUrl: 'https://k/v1', apiKey: 'K' }, fetchImpl: upstream as unknown as typeof fetch, record: async (e: JournalEntry) => { journal.push(e); }, now: () => 1, hash: (s: string) => s };
    const sys = { role: 'system', content: 'S' };
    await proxyChat({ ...deps, body: JSON.stringify({ messages: [sys, { role: 'user', content: 'first request' }] }) });
    await proxyChat({ ...deps, body: JSON.stringify({ messages: [sys, { role: 'user', content: 'first request' }, { role: 'assistant', content: 'done' }, { role: 'user', content: 'second request' }] }) });
    expect(journal.map((e) => [e.asked, e.conversationStart])).toEqual([['first request', true], ['second request', true]]);
    expect(journal[0].conversationKey).not.toBe(journal[1].conversationKey);
  });
  it('bodyCheck: a published reply body hashes to the journal\'s bodySha256', async () => {
    const { bodyCheck } = await import('../src/domain/kilnJournal');
    const e = { ...entryFromKilnResponse(r([]), { generationId: 'g', latencyMs: 1, at: 1 }), bodySha256: 'h(abc)' };
    expect(bodyCheck([e], new Map([['g', 'abc']]), (s) => `h(${s})`)).toMatchObject({ checked: 1, hashMatch: 1 });
    expect(bodyCheck([e], new Map([['g', 'abd']]), (s) => `h(${s})`)).toMatchObject({ checked: 1, ok: 0, hashMatch: 0, bad: ['g: sha256 differs from the journal, tool calls differ from the journal'] });
  });
});

describe('round-6 review: a retry in a later Kiln reply must not pay twice', () => {
  const r = (calls: string[]) => reply(calls.map((a) => ({ name: 'spendline_pay', arguments: a })));
  const gpu = (why: string) => `{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"${why}"}`;
  it('occurrence counts identical items only inside one Kiln reply; a later reply of the same turn asking for the same item again (a retry after a timeout or an error) restarts at 0 — so it maps to the earlier paid purchase and is refused as a repeat', () => {
    const g1: JournalEntry = { ...entryFromKilnResponse(r([gpu('eval run')]), { generationId: 'g1', latencyMs: 1, at: 1000 }), conversationKey: 'K', conversationStart: true, asked: 'Buy 1 GPU hour' };
    const g2: JournalEntry = { ...entryFromKilnResponse(r([gpu('retry: the tool timed out')]), { generationId: 'g2', latencyMs: 1, at: 5000 }), conversationKey: 'K', conversationStart: false, asked: 'Buy 1 GPU hour' };
    const first = findWitness([g1, g2], { name: 'spendline_pay', args: JSON.parse(gpu('eval run')) }, { now: 2000, used: new Set() });
    const retry = findWitness([g1, g2], { name: 'spendline_pay', args: JSON.parse(gpu('retry: the tool timed out')) }, { now: 6000, used: new Set([first!.key]) });
    expect([first?.occurrence, retry?.occurrence]).toEqual([0, 0]);
    expect(retry).toMatchObject({ generationId: 'g2', conversation: 'g1', asked: 'Buy 1 GPU hour' });
  });
});

describe('round-6 review: a published reply body is checked against the journal AND against Kiln\'s own record', () => {
  const pay = '{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"eval"}';
  const body = JSON.stringify({ created: 1000, choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'spendline_pay', arguments: pay } }] } }], usage: { prompt_tokens: 692, completion_tokens: 101, cost: 0.00007568 } });
  const e = { ...entryFromKilnResponse(JSON.parse(body), { generationId: 'g', latencyMs: 1, at: 1_000_000 }), bodySha256: `h(${body})` };
  const kiln = { g: { id: 'g', model: 'qwen3-32b', totalCost: 0.00007568, promptTokens: 692, completionTokens: 101, createdAt: 1002 } };
  it('the body\'s tool calls re-parse to the journal\'s, and its usage and time agree with Kiln\'s GET /v1/generations record for that id', async () => {
    const { bodyCheck } = await import('../src/domain/kilnJournal');
    expect(bodyCheck([e], new Map([['g', body]]), (s) => `h(${s})`, kiln)).toEqual({ checked: 1, ok: 1, bad: [], hashMatch: 1, callsMatch: 1, kilnMatch: 1 });
  });
  it('a journal whose tool calls differ from the body, or a body whose tokens differ from Kiln\'s record, is named', async () => {
    const { bodyCheck } = await import('../src/domain/kilnJournal');
    const edited = { ...e, toolCalls: [{ ...e.toolCalls[0], arguments: pay.replace('"quantity":1', '"quantity":2') }] };
    expect(bodyCheck([edited], new Map([['g', body]]), (s) => `h(${s})`, kiln)).toMatchObject({ ok: 0, callsMatch: 0, bad: ['g: tool calls differ from the journal'] });
    expect(bodyCheck([e], new Map([['g', body]]), (s) => `h(${s})`, { g: { ...kiln.g, completionTokens: 99 } })).toMatchObject({ ok: 0, kilnMatch: 0, bad: ['g: usage or time differs from Kiln\'s record'] });
  });
});

describe('round-7 review: a second identical item after a PAID result the model saw is a new purchase; after an error or no result it is a retry', () => {
  const gpu = (why: string) => `{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"${why}"}`;
  const history = (result: string | undefined) => [
    { role: 'system', content: 'S' }, { role: 'user', content: 'Two GPU hours, one per job' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'spendline_pay', arguments: gpu('job 1') } }] },
    ...(result === undefined ? [] : [{ role: 'tool', tool_call_id: 'c1', content: result }]),
  ];
  it('paidSeen lists the items of pay calls since the last user turn whose tool result said ok with a receipt', async () => {
    const { paidSeen } = await import('../src/domain/kilnJournal');
    expect(paidSeen(history('{"ok":true,"receipt_seq":37,"summary":"Paid"}'))).toEqual(['gpu shop|gpu-hours|1']);
    expect(paidSeen(history('{"ok":false,"reason":"DUPLICATE_RECEIPT","replay_of":37}'))).toEqual([]);
    expect(paidSeen(history('Error: timed out'))).toEqual([]);
    expect(paidSeen(history(undefined))).toEqual([]);
  });
  it('findWitness: occurrence = identical items earlier in this reply + identical items the model already saw paid', () => {
    const g2 = (seen: string[]): JournalEntry => ({ ...entryFromKilnResponse(reply([{ name: 'spendline_pay', arguments: gpu('job 2') }]), { generationId: 'g2', latencyMs: 1, at: 5000 }), conversationKey: 'K', conversationStart: false, paidSeen: seen });
    const w = (seen: string[]) => findWitness([g2(seen)], { name: 'spendline_pay', args: JSON.parse(gpu('job 2')) }, { now: 6000, used: new Set() });
    expect(w(['gpu shop|gpu-hours|1'])?.occurrence).toBe(1); // saw #37 paid → the second hour is a new purchase
    expect(w([])?.occurrence).toBe(0); // no paid result seen (error / timeout) → a retry → maps to the paid one, refused
  });
  it('proxyChat journals paidSeen from the request it forwards', async () => {
    const journal: JournalEntry[] = [];
    const upstream = async () => new Response(JSON.stringify(reply([])), { status: 200, headers: { 'x-neocloud-generation-id': 'g' } });
    await proxyChat({ kiln: { baseUrl: 'https://k/v1', apiKey: 'K' }, fetchImpl: upstream as unknown as typeof fetch, record: async (e) => { journal.push(e); }, now: () => 1, hash: (s) => s, body: JSON.stringify({ messages: history('{"ok":true,"receipt_seq":37}') }) });
    expect(journal[0].paidSeen).toEqual(['gpu shop|gpu-hours|1']);
  });
});
