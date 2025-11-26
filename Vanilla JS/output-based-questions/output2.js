// Approach 1 using function call: Without changing var to let, how to print correct numbers
for (var i = 0; i < 3; i++) {
	function print(i) {
	    setTimeout(() => {
	      console.log(i)
	    }, 100)
	  }
	  print(i); 
}
// Approach 2 using IIFE: Without changing var to let, how to print correct numbers
for (var i = 0; i < 3; i++) {
  /* Workaround 2 */
  (function(i) {
  	setTimeout(() => {
      console.log(i)
    }, 100)
  })(i)  
}

let person = { name: 'ABC' };
const people = [person];
person = null;
console.log(people);

function checkUser(userObj) {
	if (userObj === {userId: 1}) {
  	console.log('Case 1 User found')
  } else if (Object.is(userObj, {userId: 1})) {
  	console.log('Case 2 User found')
  } else {
  	console.log('User not found')
  }
}

checkUser({userId: 1});


function getInfo(one, two, three, four) {
	console.log('getInfo', one, two, three, four);
}
const name = 'Mike';
const role = 'Developer'
const empId = 123;
getInfo`${name} is ${role} ${empId}`

/* Custom method for string */
String.prototype.fullName = function() {
	return `My name is ${this}`;
}
const name = "Indrasis";
console.log(name.fullName())

/* Arrow function doesn't have this, so doesn't have prototype chain */
const printArrow = () => 'Arrow func';
const print = function() { return 'Func'; }
console.log(printArrow.prototype, print.prototype);

/* Output based - object reference and pass by value concept */
function changeStuff(a, b, c)
{
  a = a * 10;
  b.item = "changed";
  c = {item: "changed"};
}

var num = 10;
var obj1 = {item: "unchanged"};
var obj2 = {item: "unchanged"};

changeStuff(num, obj1, obj2);

console.log(num);
console.log(obj1.item);    
console.log(obj2.item);

/* Object.freeze works on top level object and not nested object */
let person = {
    name: "Leonardo",
    profession: {
        name: "developer"
    }
};
Object.freeze(person); 
person.name = 'Edward';
person.profession.name = "doctor";
console.log(person);

/* Object static question */
class Chameleon {
  static colorChange(newColor) {
    this.newColor = newColor;
    return this.newColor;
  }

  constructor({ newColor = 'green' } = {}) {
    this.newColor = newColor;
  }
}
const freddie = new Chameleon({ newColor: 'purple' });
console.log(freddie.colorChange('orange'));

/* Anything except primitive types are objects, so we can assign bark.animal */
function bark() {
  console.log('Woof!');
}
bark.animal = 'dog';
console.dir(bark)

/* Method available to all object instances - use prototype, otherwise it gets attached to constructor function */
function Person(firstName, lastName) {
  this.firstName = firstName;
  this.lastName = lastName;
}
const member = new Person('Lydia', 'Hallie');
// Added to constructor function object
Person.getFullName = function() {
  return `${this.firstName} ${this.lastName}`;
};
console.dir(member)
console.log(member.getFullName());

/* new v/s normal function */
function Person(firstName, lastName) {
  this.firstName = firstName;
  this.lastName = lastName;
}
const lydia = new Person('Lydia', 'Hallie');
const sarah = Person('Sarah', 'Smith');
console.log(lydia, sarah);

/* Object keys are always treated as string whereas it doesn't work that way for Set */
const obj = { 1: 'a', 2: 'b', 3: 'c' };
const set = new Set([1, 2, 3, 4, 5]);
obj.hasOwnProperty('1');
obj.hasOwnProperty(1);
set.has('1');
set.has(1);

/* Variable scope */
(() => {
  let x, y;
  try {
    throw new Error();
  } catch (x) {
    (x = 1), (y = 2);
    console.log(x);
  }
  console.log(x);
  console.log(y);
})();
// 1, undefined, 2  (x outside try/catch is undefined)

/**
 * https://github.com/lydiahallie/javascript-questions?tab=readme-ov-file#26-the-javascript-global-execution-context-creates-two-things-for-you-the-global-object-and-the-this-keyword
 */

/* Ref: https://plainenglish.io/blog/50-javascript-output-questions */

const ans1 = NaN === NaN; 
const ans2 = Object.is(NaN, NaN);
console.log(ans1, ans2); // false, true 

var a = 3;
var b = {
  a: 9,
  b: ++a
};
console.log(a + b.a + ++b.b);
// 4 + 9 + 5 = 18 

const foo = () => console.log('First');
const bar = () => setTimeout(() => console.log('Second'));
const baz = () => console.log('Third');
bar();
foo();
baz();
// First, Third, Second

let output = (function(x) {
    delete x;
    return x;
})(0);
// Output = 0 (Delete operator is used to delete operator of object but x is local variable)

const func = (function(x) {
  delete x.id;
  return x;
})({id: 1, name: 'abc'});
// Output: {name: 'abc'}


