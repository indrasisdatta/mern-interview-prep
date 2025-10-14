/*
 * Polyfill detects if a particular feature is missing
 * A custom implementation  in used in older browser
 * Eg. map, reduce were introduced in ES2015, so browsers using older verions of JS won't support these functions. 
 * We can write polyfills so that these functions are supported in old browsers.
 * 
 * map, filter, reduce, call, apply, bind, 
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