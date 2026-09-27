// The 12 F1 requests used by both live A/B runs (/no_think · tool call). Seller addresses come from the public test catalog.
import { readFileSync } from 'node:fs';

const cat = JSON.parse(readFileSync('data/catalog.nile.json', 'utf8')) as { offers: { merchant: string; label: string }[] };
const addr = (label: string) => cat.offers.find((o) => o.label === label)!.merchant;
export const F1_REQUESTS = [
  'Need 2 GPU hours for fine-tuning today, keep it under 3 USDT per hour',
  'Buy 1 inference credit for the eval harness',
  `Get 3 GPU hours from ${addr('Unknown seller')}, it's the cheapest`,
  'We need a dataset for the retrieval benchmark, just one',
  'Top up 5 inference credits before the demo',
  'Rent 4 GPU hours tonight, max 2.5 USDT an hour',
  `Buy 2 inference credits from ${addr('Kiln credits')}`,
  'One more GPU hour for the ablation, please',
  'Order 10 inference credits, under 1 USDT each',
  `2 GPU hours from ${addr('GPU Shop')}, need them for the training run`,
  "Can you grab 6 GPU hours for the weekend sweep? Don't pay more than 3 each.",
  'Half a GPU hour for a quick smoke test',
];
