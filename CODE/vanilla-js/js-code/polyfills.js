/*
 * Polyfill detects if a particular feature is missing
 * A custom implementation  in used in older browser
 * Eg. map, reduce were introduced in ES2015, so browsers using older verions of JS won't support these functions. 
 * We can write polyfills so that these functions are supported in old browsers.
 * 
 * map, filter, reduce, 
 * call, apply, bind, 
 * promise, promise.all(), 
 * debounce, throttle, once, memoize, 
 */

/* 1. Map Polyfill: map(element, index, array) */
Array.prototype.myMap = function(callbackFn) {
  const len = this.length;
  const tempArr = [];
  if (len > 0) {
    for (let i = 0; i < len; i++) {
      tempArr.push(callbackFn(this[i], i, this))
    }
  }
  return tempArr;
}

const arr = [1, 4, 5];
console.log('map Polyfill: ', arr.myMap(num => num*2));

/* 2. filter(element, index, array) */

Array.prototype.myFilter = function(callbackFn) {
  const len = this.length;
  const tempArr = [];
  if (len > 0) {
    for (let i = 0; i < len; i++) {
      if (callbackFn(this[i], i, this)) {
        tempArr.push(this[i]);
      }
    }
  }
  return tempArr;
}

console.log('filter Polyfill: ', arr.myFilter(num => num > 2));

/** 
 * 3. Reduce Polyfill: 
 * arr.reduce((acc, currentVal, currentIndex, arr) => {}, initialVal)
 */
Array.prototype.myReduce = function(callbackFn, initialVal) {
  var accumulator = initialVal;
  for (let i = 0; i < this.length; i++) {
    accumulator = accumulator ? 
                  callbackFn(accumulator, this[i], i, this) : 
                  this[i];
  }
  return accumulator;
}

console.log(arr.myReduce((acc, cur, i, arr) => acc + cur, 0))

/**
 * 4. call polyfill
 * calculateInterest.call(savingsBank, 'John', '$')
 */
Function.prototype.myCall = function(context = {}, ...args) {
    if (typeof this !== "function") {
        throw new Error("Not callable function");
    }
    context.fn = this;
    context.fn(...args);
}

const savingsBank = {
  principal: 10000,
  rate: 0.05,
  time: 2
};
function calculateInterest(customerName, currency) {
  const interest = this.principal * this.rate * this.time / 100;
  console.log(`${customerName} received interest of ${currency}${interest}`)
}

// calculateInterest.call(savingsBank, 'John', '$')
calculateInterest.myCall(savingsBank, 'John', '$')

/**
 * 5. apply Polyfill
 * calculateInterest.apply(savingsBank, ['John', '$'])
 */
Function.prototype.myApply = function(context = {}, args=[]) {
    if (typeof this !== "function") {
        throw new Error("Not callable function");
    }
    if (!Array.isArray(args)) {
      throw new Error("Expected args array");
    }
    context.fn = this;
    context.fn(...args);
}
calculateInterest.myApply(savingsBank, ['John', '$'])

/**
 * 6. bind Polyfill
 * const showInterest = calculateInterest.bind(savingsBank, 'John', '$');
    showInterest();
    OR
    const showInterest2 = calculateInterest.bind(savingsBank);
    showInterest2('Jane', '$');
    const showInterest2 = calculateInterest.bind(savingsBank, 'Will');
    showInterest2('$');
 */
Function.prototype.myBind = function(context = {}, ...args) {
    if (typeof this !== "function") {
        throw new Error("myBind is not callable")
    }
    context.fn = this;    
    return function(...newArgs) {
        context.fn(...args, ...newArgs);
    }
}
const showInterest = calculateInterest.myBind(savingsBank, 'Will');
showInterest('$');

/**
 * 7. Promise polyfill
 */
function PromisePolyfill(executor) {
  let status = 'pending';
  let value, onResolve, onReject;

  function resolve(val) {
    value = val;
    status = 'fulfilled';
    if (onResolve) onResolve(val);
  }
  function reject(val) {
    value = val;
    status = 'rejected';
    if (onReject) onReject(val);
  }

  this.then = function(callback) {
    onResolve = callback;
    if (status === 'fulfilled') onResolve(value);
    return this;
  }
  this.catch = function(callback) {
    onReject = callback;
    if (status === 'rejected') onReject(value);
    return this;
  }

  executor(resolve, reject);
}

// var promiseEg = new Promise((resolve, reject) => resolve(5));
var promiseEg = new PromisePolyfill((resolve, reject) => resolve(5));

promiseEg
  .then(res => console.log('Resolved: ', res))
  .catch(e => console.error(e));

/**
 * 7. Promise.all polyfill
 */
Promise.allPolyfill = function(promises) {
  return new Promise((resolve, reject) => {
    /* Empty args */
    if (!Array.isArray(promises) || promises.length === 0) {
      resolve([]);
      return;
    }
    let results = [];
    let completed = 0;
    promises.forEach((promise, index) => {
      Promise.resolve(promise)
        .then(res => {
          results.push(res);
          completed++;
          /* When all are completed, return all results together */
          if (completed === promises.length) {
            resolve(results)
          }
        })
        .catch(e => reject(e));
    });
  });
}

var promise1 = new Promise((resolve, reject) => resolve(5));
var promise2 = 42;
var promise3 = Promise.resolve(13);

Promise.allPolyfill([promise1, promise2, promise3])
  .then(res => console.log('Resolved: ', res))
  .catch(e => console.error(e));

/** 
 * Promise.allSettled polyfill
 */
Promise.allSettledPolyfill = function(promises) {
  return new Promise((resolve, reject) => {
    /* Empty args */
    if (!Array.isArray(promises) || promises.length === 0) {
      resolve([]);
      return;
    }
    let results = [];
    let completed = 0;
    promises.forEach((promise, index) => {
      Promise.resolve(promise)
        .then(res => {
          results[index] = {status: 'fulfilled', value: res };
        })
        .catch(e => {
          results[index] = {status: 'rejected', value: e };                  
        })
        .finally(() => {
          completed++;  
          /* When all are settled, return all results together */
          if (completed === promises.length) {
            resolve(results);
          }
        })
    });
  });
}

var promise1 = new Promise((resolve, reject) => resolve(5));
var promise2 = 42;
var promise3 = Promise.reject(13);

Promise.allSettledPolyfill([promise1, promise2, promise3])
  .then(res => console.log('Resolved: ', res))
  .catch(e => console.error(e));

/* ------------- Debounce ---------------- */

/*

<style>
  .container { 
    display: flex;
    gap: 10px;  
    margin: 10px 0;
  }
  .container div {
    padding: 0 10px;
    background: #ddd; 
    text-align: center;;
  }
</style>
<button id="debounce-btn">Debounce</button> 
<button id="throttle-btn">Throttle</button> 

<div class="container">
  <div>
    <h4>Debounce counts:</h4>
    <p id="count-no">0</p>
    <p id="delay-count-no">0</p>
  </div>
  <div>
    <h4>Throttle counts:</h4>
    <p id="throttle-no">0</h4>
    <p id="throttle-count-no">0</h4>
  </div>
</div>*/

let num = 0;
const debounce = (func, delay) => {
  let timer;
  return function(...args) {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      func(...args);
    }, delay);
  }
}

const debounceCount = debounce((num) => {
  document.getElementById('delay-count-no').innerText = num;
}, 1000);

/* Debounce button handler */
document.getElementById('debounce-btn').addEventListener('click', function() {
  num++;
  document.getElementById('count-no').innerText = num;
  /* Debounce function call */
  debounceCount(num);
});

/* ------------- Throttle ------------------ */

let throttleNum = 0;

const throttle = (func, delay) => {
  let lastCalledTime = 0;
  return function(...args) {
    let currentTime = new Date().getTime();
    if (currentTime - lastCalledTime < delay) {
      return;
    }
    lastCalledTime = currentTime;
    func(...args);
  }
}

const throttleCount = throttle((num) => {
  document.getElementById('throttle-count-no').innerText = num;
}, 1000);

/* Throttle button handler */
document.getElementById('throttle-btn').addEventListener('click', function() {
  num++;
  document.getElementById('throttle-no').innerText = num;
  throttleCount(num);
});

/* Memoize function using closure */
const memoize = (func) => {
  let cache = {};
  return function(...args) {
    let key = JSON.stringify([...args]);
    // console.log('Check cache: ', cache);
    if (cache.hasOwnProperty(key)) {
      console.log('Cache hit: ', key);
      return cache[key];
    }
    console.log('Cache miss: ', key);
    let result = func(...args);
    cache[key] = result;
    return result;
  }
}

const calculate = (a, b) => {
  let c = 0;
  for (let i = 0; i < 100000000; i++) {
    c += i + a + b;
  }
  // console.log('Calculate called')
  return c;
}

const memoCalc = memoize(calculate);
console.log('--- Result 5, 10', memoCalc(5, 10));
console.log('--- Result 5, 10', memoCalc(5, 10));
console.log('--- Result 5, 10', memoCalc(5, 10));
console.log('--- Result 10, 3', memoCalc(10, 3));
console.log('--- Result 5, 4', memoCalc(5, 4));

/* Call function only once */
const callOnce = function(func) {
  let isCalled = false;
  return (...args) => {
    if (!isCalled) {
      isCalled = true;
      return func(...args);
    }    
  }
}

const calculate = (a, b) => {
  let c = 0;
  for (let i = 0; i < 100000000; i++) {
    c += i + a + b;
  }
  return c;
}

const onceFunc = callOnce(calculate);
console.log('--- Call 1', onceFunc(5, 10));
console.log('--- Call 2', onceFunc(5, 10));
console.log('--- Call 3', onceFunc(5, 10));
console.log('--- Call 4', onceFunc(10, 3));
console.log('--- Call 5', onceFunc(5, 4));

