/**
 * Array Reduce method
 */

/* Use case 1: Calculate sum */
const employees = [
	{id: 1, name: 'Emp A', salary: 10000},
  {id: 2, name: 'Emp B', salary: 8000},
  {id: 3, name: 'Emp C', salary: 15000},
  {id: 4, name: 'Emp D', salary: 12000},
  {id: 5, name: 'Emp E', salary: 20000},
];
const totalSalary = employees.reduce((acc, cur, index) => {
	// console.log(acc, cur, index)
  return acc + cur.salary
}, 0);
console.log('Total salary: ', totalSalary)

/* Use case 2: Find occurrences of each value */
const fruits = [ 'Banana', 'Orange', 'Apple', 'Orange', 'Pear', 'Banana']
const fruitFreq = fruits.reduce((acc, cur) => {	
  return {...acc, [cur]: (acc.hasOwnProperty(cur) ? acc[cur] + 1 : 1)}
}, {});
console.log('Frequency of array indices: ', fruitFreq);

/* Use case 3: Find max and min*/
const students = [
    { name: "Kingsley", score: 70 },
    { name: "Jack", score: 80 },
    { name: "Joe", score: 63 },
    { name: "Beth", score: 75 },
    { name: "Kareem", score: 59 },
    { name: "Sarah", score: 93 }
]
const maxScore = students.reduce((acc, cur) => {
  if (cur.score > acc) {
  	acc = cur.score;
  }
  return acc;
}, -Infinity);
console.log('Max score: ', maxScore);
