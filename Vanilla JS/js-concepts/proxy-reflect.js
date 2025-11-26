/**
 * Proxy - intercepts before it reachers the object
 * Reflect - safe/official way to perform the low level action 
 */
const obj = { name: 'User A', age: 12 };
const proxyObj = new Proxy(obj, {
  get(target, prop) {
    if (prop in target) return Reflect.get(target, prop);
    throw new Error("Invalid key");
  },
  set(target, prop, value) {
    if (prop === 'age' && isNaN(value)) {
      throw new Error("Age should be a number");
    }
    return Reflect.set(target, prop, value);
  }
});

proxyObj.age = 15;
console.log('Age: ', proxyObj.age);

// console.log('Accessing invalid key: ', proxyObj.xyz);

proxyObj.age = "a";
console.log('Age: ', proxyObj.age);



