/**
 * Sub array sum equals K 
 * https://leetcode.com/problems/subarray-sum-equals-k/description/
 * @param {number[]} nums
 * @param {number} k
 * @return {number}
 */
var subarraySum = function(nums, k) {
  if (!Array.isArray(nums) || isNaN(k)) {
    console.error('Invalid input');
    return 0;
  }
  let sumMapper = new Map();
  let result = 0;
  let prefixSum = 0;
  sumMapper.set(0,1);
  for (let num of  nums) {
    prefixSum += num;
    let findElm = prefixSum - k;
    if (sumMapper.has(findElm)) {
     result += sumMapper.get(findElm);
    }
    /* Set sum and frequency */
    sumMapper.set(prefixSum, (sumMapper.get(prefixSum) || 0) + 1);
  }
  return result;
};

console.log(subarraySum([1,1,1], 2)); // 2
console.log(subarraySum([1,2,3], 3)); // 2
// 1
// 1,2 // 3 (OK)
// 1,2,3
// 2
// 2,3
// 3 // 3 (OK)
subarraySum([1,2,1,2,1], 3) // 4


