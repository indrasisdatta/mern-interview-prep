/**
 * https://leetcode.com/problems/minimum-size-subarray-sum/
 * 209. Minimum Size Subarray Sum
 * @param {number} target
 * @param {number[]} nums
 * @return {number}
 */
var minSubArrayLen = function(target, nums) {
    // target = 7, nums = [2,3,1,2,4,3]
    // 2,3,1,2  1,2,4  2,4,3  4,3
    let minLen = nums.length + 1, start = 0, sum = 0;

    for (let end = 0; end < nums.length; end++) {
        if (nums[end] >= target) return 1;
        sum += nums[end];
        while (sum >= target) {
            // console.log('Sum target achieved!', {sum, start, end})
            minLen = Math.min(minLen, end - start + 1);  
            sum -= nums[start++];
        }
        // minLen = Math.min(minLen, end - start + 1);
    }
    return minLen === nums.length + 1 ? 0 : minLen;
};