/**
 * Flatten nested array without using any in-built function
 */

const arr = [1, 2, 3, ["4",5], ["6",[7,8, [9, 10, [11,12]]]]];

const flattenArray = (arr, tempArr = []) => {
	for (let i in arr) {
  	console.log(arr[i].constructor)
  	//if (Array.isArray(arr[i])) {
    //if (arr[i] instanceof Array) {
    if (arr[i].constructor === Array) {
    	flattenArray(arr[i], tempArr);
    } else {
    	tempArr.push(arr[i]);
    }
  }
  return tempArr;
}

console.log(flattenArray(arr))
