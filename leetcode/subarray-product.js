/**
 * Given an array of integers nums and an integer k, 
 * return the number of contiguous subarrays 
 * where the product of all the elements in the subarray is strictly less than k.
 * https://leetcode.com/problems/subarray-product-less-than-k/?envType=daily-question&envId=2024-03-27
 * [10], [5], [2], [6], [10, 5], [5, 2], [2, 6], [5, 2, 6]
 *
 * @param {number[]} nums
 * @param {number} k
 * @return {number}
 */
// i = 10   j = 5,2,6  5,2 5 
// i = 5    j = 2,6 2
// i = 2    j = 6
// i < len - 1
// j = i+1 to len  len --
// 

const numSubarrayProductLessThanK = function(nums, k) {
    let len = nums.length, 
        subArr = [];
  	if (k === 0) return 0;
    for (let i = 0; i < len; i++) {
      /* Single number */
      if (nums[i] < k && !subArr.includes(nums[i])) {
      	subArr.push([nums[i]]);
      }
      for (let j = len; j > i; j--) {
      	let sliced = nums.slice(i+1, j);
        if (sliced.length == 0) continue;
        let combinedArr = [nums[i], ...sliced];
        let prodArr = combinedArr.reduce((acc, a) => acc * a, 1);
        if (prodArr < k) {
        	subArr.push(combinedArr);
        }
      }
    }
    return subArr.length;
}

console.log(numSubarrayProductLessThanK([10,5,2,6], 100));
console.log(numSubarrayProductLessThanK([1,2,3], 0));
