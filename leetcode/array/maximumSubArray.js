/**
 * https://leetcode.com/problems/maximum-subarray/?envType=problem-list-v2&envId=array
 * Kadane's algorithm approach
 */
const maxSubArray = function(nums) {
    if (!nums || !Array.isArray(nums) || nums.length === 0) {
        console.error("Invalid input");
        return;
    }
    if (nums.length === 1) {
        return nums[0];
    }
    // [-2,1,-3,4,-1,2,1,-5,4]
    let sum = 0, maxSum = 0;
    for (let i = 0; i < nums.length; i++) {
        sum += nums[i];
        if (sum < 0) {
            sum = 0;
        }
        if (sum > maxSum) {
            maxSum = sum;
        }
    }
    return maxSum;
}



/**
 * @param {number[]} nums
 * @return {number}
 */
var maxSubArray = function(nums) {
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