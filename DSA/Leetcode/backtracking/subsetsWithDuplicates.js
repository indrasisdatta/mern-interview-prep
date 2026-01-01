/**
 * https://leetcode.com/problems/subsets-ii/
 * 90. Subsets II
 * @param {number[]} nums
 * @return {number[][]}
 */
var subsetsWithDup = function(nums) {
    nums = nums.sort((a, b) => a - b);
    let result = [], subsets = [];
    function backtrack(index) {
        result.push([...subsets]);
        for (let i = index; i < nacums.length; i++) {
            // [1,2,2] => nums[2] === nums[1] so skip
            if (i > index && nums[i] === nums[i-1]) {
                continue;
            }
            subsets.push(nums[i]);
            backtrack(i+1);
            subsets.pop();
        }
    }
    backtrack(0);
    return result;
};