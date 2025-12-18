/**
 * Sub array sum equals K 
 * https://leetcode.com/problems/subarray-sum-equals-k/description/
 * @param {number[]} nums
 * @param {number} k
 * @return {number}
 * [1, 2, 4, 5, 6], k = 11   Output: 2
 */
const subarraySum = function(nums, k) {
    let output = 0;
    let sum = 0;
    let charMap = new Map();
    charMap.set(0, 1);
    for (let i = 0; i < nums.length; i++) {
        sum += nums[i];    
        let target = sum - k;
        if (charMap.has(target)) {
            output += charMap.get(target);
        }
        charMap.set(sum, (charMap.get(sum) || 0) + 1 );        
    }
    return output;
 }