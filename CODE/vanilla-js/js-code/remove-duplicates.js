/**
 * Remove duplicates from array
 * without using any in-built functions
 */
const removeDuplicatesArr = (arr) => {
	let start = 0, end = start + 1, len = arr.length;
  let result = [];
 	let checkMap = new Map();
  for (let val of arr) {
  	if (!checkMap.has(val)) {
    	checkMap.set(val, true);
      result.push(val)
    }
  }
  return result;
}

const arr = [8, 2, 23, 12, 8, 1, 23, 42, 8];
console.log('Result: ', removeDuplicatesArr(arr))


const removeDuplicates = (arr) => {
  /* Store frequency of each no in this map */
  let elementMap = new Map();
  for (let num of arr) {
    if (elementMap.has(num)) {
      let freq = elementMap.get(num);
      elementMap.set(num, freq+1);
    } else {
      elementMap.set(num, 1);
    }
  }
  /* From map, find elements which occurs more than once */
  return Array.from(elementMap)
              .filter(([num, freq]) => {
                return freq > 1;
              })
              .reduce((acc, cur) => {
                console.log(acc, cur[0])
                return [...acc, cur[0]]
              }, [])
  
}

const arr = [1, 12, 1, 5, 34, 2, 1, 34, 14, 65, 5, 65, 76, 65, 76, 76];
console.log(removeDuplicates(arr));
