/**
 * Iterators - can be iterated by repeatedly calling next()
 * Returns {value: <val>, done: <bool>}
 * String, Array, TypedArray, Map, Set are in-build Iterables as they inherit [Symbol.iterator] method
 */
const userSet = new Set(['user1', 'user2', 'user3']);
for (let l of userSet) {
  console.log(l)
}

const userMap = new Map([
	[1, 'user1'], 
  [2, 'user2'], 
  [3, 'user3']
]);
for (let [id, name] of userMap) {
  console.log(id, name)
}
