function *generateId(len) {
	let i = 1;
  console.log('Gen before loop')
  while (i <= len) {
  	console.log('Gen before yield')
  	yield i;
    i++;
    console.log('Gen after yield')
  }  
  console.log('Gen after loop')
}

const id = generateId(3);
console.log(id.next())
console.log(id.next())
console.log(id.next())
console.log(id.next())
