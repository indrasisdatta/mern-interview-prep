/**
 * Map v/s Objects
 * - Map is ordered and iterable | Objects are unordered and non-iterable (can iterate over keys using for in loop)
 * - Map key can be any datatype (object, function, array, string etc.) | Object keys should be number, string or symbol
 */
const obj = {
	id: 1,
  name: "User A",
  age: 20
};
const userMap = new Map(Object.entries(obj));
for (let [key, value] of userMap) {
	console.log(`${key}: ${value}`)
}

/**
 * Weakmap: https://javascript.info/weakmap-weakset
 * Weakmaps 
 *   - keys must be objects and not primitive values
 *   - if there are no ref to the object, it will be removed from memory and weak map automatically
 *   - supports only these methods - get() set() has() delete() 
 *   - not iterable
 */
let john = { name: "John" };

let weakMap = new WeakMap();
weakMap.set(john, "...");

john = null; // overwrite the reference
// john is removed from memory!

