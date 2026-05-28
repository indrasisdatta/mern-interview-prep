const memoFunc = (num) => {
	let cache = new Map();
  return (addNo) => {
    if (cache.has(addNo)) {
      console.log('Retrieve from cache', addNo)
      return cache.get(addNo);
    }
    console.log('Not found in cache..calculate', addNo)
    const result = num + addNo;
    cache.set(addNo, result);
    return result;
  }
}
const add = memoFunc(10);
console.log(add(2));
console.log(add(3));
console.log(add(2));
console.log(add(5));


