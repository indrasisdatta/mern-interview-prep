/**
 * Get Immutable
 * https://medium.com/frontend-army/my-agoda-frontend-interview-experience-82-lpa-senior-software-engineer-6eda35f4df67
 */

class MyClass {
  
  constructor(a, b, c) {
    this.a = a;
    this.b = b;
    this.c = c;
    this._mutable = true;
  }

  sum() {
    return this.a + this.b + this.c;
  }

  getImmutableCopy() {
    const copyObj = new MyClass(this.a, this.b, this.c, false);
    return Object.freeze(copyObj);
  }

  isMutable() {
    return this._mutable;
  }
}

const myClass = new MyClass(5, 6, 7);
const copyClass = myClass.getImmutableCopy();

console.log(myClass.isMutable());
console.log(copyClass.isMutable());


