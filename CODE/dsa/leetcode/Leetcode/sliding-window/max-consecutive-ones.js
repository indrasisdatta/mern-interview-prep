/**
 * https://leetcode.com/problems/max-consecutive-ones-iii/
 * https://leetcode.com/problems/max-consecutive-ones-iii/
 * @param {number[]} nums
 * @param {number} k
 * @return {number}
 */
var longestOnes = function(nums, k) {
    let start = 0, countZeroes = 0, maxLen = -Infinity;
    // Issue faced - trying to reset end every time
    // Challenge - how to reset window? When k is reached
    for (let end = 0; end < nums.length; end++) {
        if (nums[end] === 0) countZeroes++;
        /* Window limit reached, reset count and increment start */
        while (countZeroes > k) {
            if (nums[start] === 0) countZeroes--;
            start++;
        }
        if (end - start + 1 > maxLen) {
            maxLen = end - start + 1;
            console.log('Max Len: ', {maxLen, start, end, countZeroes});
        }   
    }
    return maxLen;
};