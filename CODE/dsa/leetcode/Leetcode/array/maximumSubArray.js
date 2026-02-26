/**
 * https://leetcode.com/problems/maximum-subarray/?envType=problem-list-v2&envId=array
 * Kadane's algorithm approach
 */
/**
 * @param {number[]} nums
 * @return {number}
 */
const maxSubArray = function(nums) {
    if (!nums || !Array.isArray(nums) || nums.length === 0) {
        console.error("Invalid input");
        return 0;
    }
    if (nums.length === 1) {
        return nums[0];
    }
    let sum = 0;
    let currentMax = nums[0];
    let resultMax = nums[0];
    for (let i = 1; i < nums.length; i++) {
      currentMax = Math.max(nums[i], nums[i] + currentMax);
      resultMax = Math.max(resultMax, currentMax);
    }
    return resultMax;
}

console.log(maxSubArray([-5, -2, -4, -14]));
// -5 -2 -4 -14





/**
 * @param {number[]} nums
 * @return {number}
 */
var maxSubArray_brute = function(nums) {
    if (!nums || !Array.isArray(nums) || nums.length === 0) {
        console.error("Invalid input");
        return;
    }
    if (nums.length === 1) {
        return nums[0];
    }
    let start = 0, end = nums.length;
    let arrayCombinations = [];
    let max = -999;

    while (start <= end) {
        let slicedArr = nums.slice(start, end);
        if (slicedArr.length > 0) {
          arrayCombinations.push(slicedArr);
        }
        if (start === end) {
            end = nums.length;
            start++;
        } else {
            end--;
        }
    }
    // console.log(arrayCombinations);

    let maxCombination = [];
    for (let i = 0; i < arrayCombinations.length; i++) {
      let slicedArr = arrayCombinations[i];
      let sum = slicedArr.reduce((initial, acc) => initial + acc, 0);
      if (sum > max) {
        maxCombination = slicedArr;
        max = sum;
      }
    }

    return max;
};

const a = [-2,1,-3,4,-1,2,1,-5,4]
const b = [1]
const c = [5,4,-1,7,8]

console.log(maxSubArray(a));
console.log(maxSubArray(b));
console.log(maxSubArray(c));