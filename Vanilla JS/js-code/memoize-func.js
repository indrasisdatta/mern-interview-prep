/**
 * Create memoize function that takes any function as an argument and caches the result
 * Caching is based on 1) function 2) inputs
 */
function memoizeOne(fn) {
	const cached = {};
	return function(...arg) {
  	let inputsKey = `${fn.name}-${arg.join('-')}`;
  	if (cached.hasOwnProperty(inputsKey)) {
    	console.log('Cached result is returned');
    	return cached[inputsKey];
    }
    cached[inputsKey] = fn(...arg);
  	// console.log('Set cache', cached);
    return cached[inputsKey];
  }	
}

const add = (a, b) => {
	console.log('Add function is called to get new value', a, b);
  return a + b;
}
const sub = (a, b) => {
	console.log('Sub function is called to get new value', a, b);
  return a - b;
}

const memoizedAdd = memoizeOne(add) ;

console.log(memoizedAdd(1, 2)); // 3
// Add function is called to get new value

console.log(memoizedAdd(1, 2)); // 3
// Add function is not
// executed: previous result is returned

console.log(memoizedAdd(2,3)); // 5

// Add function is called to get new value

console.log(memoizedAdd(2, 3)); // 5
// Add function is not executed, previous result is returned


const memoizedSub = memoizeOne(sub) ;

console.log(memoizedSub(1, 2)); 
console.log(memoizedSub(1, 2)); 
