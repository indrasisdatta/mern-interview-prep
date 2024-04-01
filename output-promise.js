/**
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
