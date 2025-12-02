const promise1 = new Promise(
  (resolve, reject) => setTimeout(() => resolve("Promise 1"), 500) 
);
const promise2 = new Promise(
  (resolve, reject) => setTimeout(() => reject("Promise 2 error"), 100) 
);
const promise3 = new Promise(
  (resolve, reject) => resolve("Promise 3") 
);

const promises = [promise1, promise2, promise3];

promises.reduce(
  (chain, p) => chain.then(() => 
    p.then((result) => console.log('Result: ', result))
      .catch(e => console.log('Error: ', e))
  ),
  Promise.resolve()
)