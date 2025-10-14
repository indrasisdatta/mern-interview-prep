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