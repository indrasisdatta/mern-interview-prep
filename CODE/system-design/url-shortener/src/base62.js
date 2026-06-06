const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const BASE = 62n;

const indexOf = new Map();
for (let i = 0; i < ALPHABET.length; i++) indexOf.set(ALPHABET[i], i);

function encode(num) {
  if (typeof num === "number") num = BigInt(num);
  if (num < 0n) throw new RangeError("encode requires non-negative");
  if (num === 0n) return ALPHABET[0];
  let out = "";
  while (num > 0n) {
    out = ALPHABET[Number(num % BASE)] + out;
    num = num / BASE;
  }
  return out;
}

function decode(str) {
  let n = 0n;
  for (const c of str) {
    const v = indexOf.get(c);
    if (v === undefined) throw new RangeError(`Invalid Base62 char: ${c}`);
    n = n * BASE + BigInt(v);
  }
  return n;
}

module.exports = { encode, decode, ALPHABET };
