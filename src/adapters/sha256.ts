import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/** Same bytes → same hex as node:crypto, but runs in the browser too, so the UI can re-check receipt hashes itself. */
export const sha256Hex = (s: string): string => bytesToHex(sha256(utf8ToBytes(s)));
