/**
 * Sub array sum equals K 
 * https://leetcode.com/problems/subarray-sum-equals-k/description/
 * @param {number[]} nums
 * @param {number} k
 * @return {number}
 * [1, 2, 4, 5, 6], k = 11   Output: 2
 */
const subarraySum = function(nums, k) {
    let numMap = new Map();
    numMap.set(0, 1);
    let currSum = 0, prefixSum = 0, count = 0;
    for (let num of nums) {
        prefixSum += num;    
        let target = prefixSum - k;    
        if (numMap.has(target)) {
            count += numMap.get(target);
        }
        numMap.set(prefixSum, (numMap.get(prefixSum) || 0) + 1);
    }
    return count;
};