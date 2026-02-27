/**
 * Write a program to print the nth Tribonacci number. 
 * A Tribonacci number is a number that has a value by 
 * adding the previous three values.
 * Eg. 0 1 1 2 4 7 13 24 44 81 ...
 */
 const fndNthTribonaci = (n) => {
 	const fiboArr = [0, 1, 1];
  if (n < 0 || isNaN(n)) {
  	return false;
  }
  if (n <= 3) { 
  	return fiboArr[n]; 
  }
  let first = 0, second = 1, third = 1;
  let fourth = first + second + third;
  for (let i = 3; i < n; i++) {
  	fourth = first + second + third;
    first = second;
    second = third;
    third = fourth;
  }
 	return fourth;
 }
 
 console.log(fndNthTribonaci(10));
