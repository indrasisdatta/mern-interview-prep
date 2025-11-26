/**
 * Symbols are immutable and unique
 * Not included in for in loop
 * Can be used as object keys
 *  - useful to assign unique identifier to object
 *  - create private properties in objects
 */
const symKey1 = Symbol("Key123");
let symKey2 = Symbol("Key456");
const symKey3 = Symbol("Key789");
const symKey1b = Symbol("Key123");
const obj1 = {
  name: "User A",
  [symKey1]: "Symbol value 1",
  [symKey2]: "Symbol value 2",
  [symKey3]: "Symbol value 3",
};
symKey2 = Symbol.for("Key99");
const obj2 = {
  [symKey2]: "Symbol value 2",
};
obj2[symKey2] = "Symbol value 2 updated";
// console.log("Compare symbol keys: ", symKey1b, symKey1, symKey1b == symKey1);

console.log("Obj2 symkey2: ", obj2, Symbol.keyFor(symKey2));

for (let k in obj1) {
  console.log(k);
}
