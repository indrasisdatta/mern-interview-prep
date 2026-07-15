/**
 * @param {number[]} nums
 * @return {void} Do not return anything, modify nums in-place instead.
 */
var moveZeroes = function(nums) {
    // Next non-zero element to be placed
    // By swapping instead of just overwriting, 
    // you automatically push the zeros to the back without needing a 
    // second loop to fill the remaining positions with zeros.
    let newPos = 0;
    for (let i = 0; i < nums.length; i++) {
        if (nums[i] !== 0) {
            let t = nums[i];
            nums[i] = nums[newPos];
            nums[newPos] = t;
            newPos++;
        }
    }
    return nums;
};