/**
 * @param {number[]} nums
 * @return {boolean}
 */
var canJump = function(nums) {
    let finalPos = nums.length - 1;
    for (let i = nums.length - 2; i >= 0; i--) {
        if (nums[i] + i >= finalPos) {
            finalPos = i;
        }
    }
    return finalPos === 0;
};