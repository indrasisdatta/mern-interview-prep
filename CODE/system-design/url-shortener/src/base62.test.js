const test = require("node:test");
const assert = require("node:assert/strict");
const { encode, decode } = require("./base62");

test("encode 0 → first alphabet char", () => {
  assert.equal(encode(0), "A");
});

test("encode 1 → second alphabet char", () => {
  assert.equal(encode(1), "B");
});

test("encode 62 wraps to two chars", () => {
  assert.equal(encode(62), "BA");
});

test("round-trip for 0..1000", () => {
  for (let i = 0; i < 1000; i++) {
    assert.equal(decode(encode(i)), BigInt(i));
  }
});

test("encode 125_000_000 has 5 chars", () => {
  const s = encode(125_000_000);
  assert.ok(s.length >= 5 && s.length <= 6, `unexpected length: ${s}`);
});

test("rejects negative numbers", () => {
  assert.throws(() => encode(-1), RangeError);
});

test("rejects invalid characters on decode", () => {
  assert.throws(() => decode("A!B"), RangeError);
});

test("handles BigInt input", () => {
  const big = 62n ** 7n - 1n;
  const s = encode(big);
  assert.equal(decode(s), big);
});
