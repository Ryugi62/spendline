/** USDT has 6 decimals on TRON. Amounts are integer micro-USDT (safe as JS numbers far beyond any test budget). */
export const USDT_DECIMALS = 6;
export const usdt = (x: number): number => Math.round(x * 10 ** USDT_DECIMALS);
export const fmtUsdt = (micro: number): string => (micro / 10 ** USDT_DECIMALS).toFixed(2);
