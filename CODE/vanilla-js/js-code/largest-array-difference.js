/**
 * Find largest difference between array elements
 * Return array pairs
 */
const largestDifference = (arr) => {
	let maxDiff = 0;
  let start = 0, end = arr.length;
  let nos = [];
  while (start < end) {
  	let diff = arr[end] - arr[start];
    if (diff > maxDiff) {
    	maxDiff = diff;
      nos = [arr[start], arr[end]];
    }
    end--;
    if (start == end) {
    	start++;
      end = arr.length;
    }
  }
  return nos;
}

const arr = [8, 2, 23, 12, 0, -44, -40, 99, 120, 115];
console.log('Result: ', largestDifference(arr))
