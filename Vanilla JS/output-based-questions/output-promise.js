/**
 * Advanced #1
 * NOTE: The callback you pass to promise is immediately executed - new Promise is immediately invoked
 * .then() is invoked asynchronously
 */
setTimeout(() => console.log(1), 0);
console.log(2);
new Promise(res => {
  console.log(3)
  res();
}).then(() => console.log(4));
console.log(5);
// Above code outputs: 2 3 5 4 1

/**
 * Advanced #2
 */
async function foo() {
  console.log("A");
  await Promise.resolve();
  console.log("B");
  await new Promise(resolve => setTimeout(resolve, 0));
  console.log("C");
}
console.log("D");
foo();
console.log("E");

/* Promise practice example functions */
/* Eg. 1 */
const customPromise = Promise.resolve('Promise data');

const promiseCall1 = () => {
	customPromise.then((res, rej) => {
  	console.log('A', res);
  })
  console.log('A is called');
}
const promiseCall2 = async() => {
	console.log('B', await customPromise);
  console.log('B is called');
}
promiseCall1();
promiseCall2();

/* Eg. 2 */
console.log(Promise.resolve(2)); // Returns Promise
// To return value, either use .then or asnc/await
(async() => {
	console.log(await Promise.resolve(2))
})()

/* Eg. 3 */
const promise1 = Promise.resolve('Promise 1');
const promise2 = Promise.resolve('Promise 2');
const promise3 = Promise.reject('Promise 3');
const promise4 = Promise.resolve('Promise 4');

const runPromise = async() => {
  const res1 = await Promise.all([promise1, promise2]);
   console.log('Res1', res1);
  const res2 = await Promise.all([promise3, promise4]); 
  console.log('Res2', res2)
  return [res1, res2];
}

runPromise()
	.then(res => console.log(res))
	.catch(err => console.error(err))

/* Promise all 4 practice examples */
const promise1 = new Promise((resolve, reject) => resolve("Promise 1 resolved"));
const promise2 = Promise.resolve("Promise 2 resolved");
const promise3 = Promise.reject("Promise 3 rejected");
const promise4 = Promise.reject("Promise 4 resolved");

// Returns Promise 3 rejected (All resolved or first rejected)
Promise
	.all([promise1, promise2, promise3, promise4])
  .then(data => {
  	console.log('Success: ', data);
  })
  .catch(e => {
  	console.log('Error: ', e);
  })

// Returns [{status: "fulfilled/rejected", value: ...}]
Promise
	.allSettled([promise1, promise2, promise3, promise4])
  .then(data => {
  	console.log('Success 2: ', data);
  })
  .catch(e => {
  	console.log('Error 2: ', e);
  })
  
// First resolved/rejected promise  
Promise
	.race([promise1, promise2, promise3, promise4])
  .then(data => {
  	console.log('Success 3: ', data);
  })
  .catch(e => {
  	console.log('Error 3: ', e);
  })

// First resolved/rejected promise  
Promise
	.any([promise3, promise2, promise1, promise4])
  .then(data => {
  	console.log('Success 4: ', data);
  })
  .catch(e => {
  	console.log('Error 4: ', e);
  })