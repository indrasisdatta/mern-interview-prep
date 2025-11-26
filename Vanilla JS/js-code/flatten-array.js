/**
 * Flatten nested array without using any in-built function
 */

const arr = [1, 2, 3, ["4",5], ["6",[7,8, [9, 10, [11,12]]]]];

const flattenArray = (arr, tempArr = []) => {
  for (let n of arr) {
    if (n.constructor.name === 'Array') {
    	flattenArray(n, tempArr);
    } else {
        // tempArr = [...tempArr, n] -> won't work as that changes the reference
    	tempArr.push(Number(n));
    }
  }
  return tempArr;
}

console.log(flattenArray(arr))
