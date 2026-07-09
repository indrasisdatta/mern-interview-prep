/**
 * @param {number[]} nums
 * @return {void} Do not return anything, modify nums in-place instead.
 */
var sortColors = function(nums) {
    for (let end = nums.length - 1; end > 0; end--) {
        let start = 0;
        while (start < end) {
            if (nums[start] > nums[end]) {
                let t = nums[start];
                nums[start] = nums[end];
                nums[end] = t;
            }
            start++;
        }
    }
    return nums;
};