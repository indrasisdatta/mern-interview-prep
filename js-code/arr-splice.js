// 1. Splice methods mutates array
// splice(start, deleteCount, item1, item2, /* …, */ itemN)
// returns array containing deleted elements
let arr = ['a', 'b', 'c', 'd'];
let res = arr.splice(1, 0, 'x', 'y');
console.log(res);
console.log(arr);

let res2 = arr.splice(3, 2, 'aa', 'bb', 'cc');
console.log(res2);
console.log(arr);

// 2. Slice doesn't mutate
// returns a shallow copy 
const fruits = ['apple', 'banana', 'orange', 'grapes', 'pineapple'];
const res1 = fruits.slice(2, 4);
console.log(res1);
console.log(fruits);

res1[0] = 'test';

console.log(res1);
console.log(fruits);

const emp = [
	{id: 1, name: 'Emp A'},
  {id: 2, name: 'Emp B'},
  {id: 3, name: 'Emp C'}
];
const empSliced = emp.slice(0, 2);
empSliced[0].id = 50; // Affects original emp array as well (shallow copy)

console.log('Original emp', emp);
console.log('Copied emp', empSliced);
