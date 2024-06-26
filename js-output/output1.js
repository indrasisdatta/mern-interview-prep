/* -------------- Question 1 -------------- */
const empObj = {
	department: "Software",
	getDepartment: function() {
  	console.log('1', this.department)
  },
  getDepartment2: () => {
  	console.log('2', this.department)
  },
  getDepartment3: (function(){	
  	console.log('3', this.department)
  })()
}

empObj.getDepartment(); // Software
empObj.getDepartment2(); // undefined
empObj.getDepartment3(); // undefined

/* -------------- Question 2 -------------- */
const emp = {
	fullName: 'Emp1',
  display: function() {
  	console.log(this.fullName);
  }
}
setTimeout(emp.display, 2000) // undefined

// Fix (can't use call as that would be executed immediately)
setTimeout(emp.display.bind(emp), 2000);

/* -------------- Question 3-------------- */
const obj = Object.create({
	fullName: "Object 1"
});
console.log(obj.fullName);
delete obj.fullName; // stored inside prototype, so doesn't work
console.log(obj.fullName);

const obj2 ={
	fullName: "Object 2"
};
console.log(obj2.fullName);
delete obj2.fullName;
console.log(obj2.fullName);

/* Question 4: Evaluating truthy/falsy values */
console.log(3+4+'5');
console.log(false || {} || 2); // returns first truthy value 
console.log(0 || null || false); // returns last if none is truthy

/* Question 5: Evaluating Symbol */
console.log(String("ABC") === String("ABC"));
console.log(Symbol("ABC") === Symbol("ABC"));

/* Question 6: Evaluating IIFE */
(() => {
	console.log('Test IIFE');
	let x, y;
  try {
  	throw new Error();
  } catch (e) {
  	(x=1), (y=2);
  	console.log(x)
  }
  console.log(x)
  console.log(y)
})();

/* Question 7: Function param (object reference) */
const person = {
  name: 'User',
  hobbies: ['Coding']
};

function addHobby(hobby, hobbies = person.hobbies) {
  hobbies.push(hobby);
  return hobbies;
}
addHobby('running', []);
addHobby('dancing'); // person.hobbies = ['Coding', 'dancing']
addHobby('baking', person.hobbies); // person.hobbies = ['Coding', 'dancing', 'baking']
console.log(person.hobbies);

/*  Object.fromEntries() */
const arr = [
  ['name', 'John'],
  ['age', 21]
];
console.log(Object.fromEntries(arr)); // {name: 'John', age: 21}
const myMap = new Map([
  ['name', 'Jane'],
  ['age', 20]
]);
console.log(Object.fromEntries(myMap)); // {name: 'Jane', age: 20}

/* Array.from() */
let arrayLike = {
  0: "Hello",
  1: "World",
  length: 2
};
let arr = Array.from(arrayLike);
console.log(arr); //  ['Hello', 'World']

let arrayOrig = [1, 2, 3, 4];
let arrayCopy = Array.from(arrayOrig);
arrayCopy.push(5);
console.log(arrayOrig, arrayCopy);

/* Async output */
function asyncOperation() {
  let result;
  setTimeout(function() {
    result = "Async operation completed";
    console.log(result);
  }, 1000);
  return function() {
    console.log(result);
  }
}
  

const asyncCallback = asyncOperation();
asyncCallback();
