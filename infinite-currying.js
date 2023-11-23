/**
 * Implement infinite currying function to calculate sum of arguments
 *
 * add(1, 2, 3)(); // 6
 * add(1, 2)(4)(10)(); // 17
 * add(2)(); // 2
 * add(1, 2, 3)(4, 5)(6)(); // 21
 */
const add = (...nos) => {
	// console.log('nos', nos);
  return (...nos2) => {  	
  	// console.log('nos2 --', nos2)
    if (nos2.length === 0) {
    	return nos.reduce((acc, cur) => acc + cur, 0);
    }
  	return add(...nos, ...nos2)
  }
}

const res1 = add(1, 2, 3)(); // 6
const res2 = add(1, 2)(4)(10)(); // 17
const res3 = add(2)(); // 2
const res4 = add(1, 2, 3)(4, 5)(6)(); // 21

console.log(res1)
console.log(res2)
console.log(res3)
console.log(res4)
