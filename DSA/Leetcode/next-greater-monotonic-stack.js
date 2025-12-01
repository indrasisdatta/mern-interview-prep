/**
 * 503. Next Greater Element II
 * https://leetcode.com/problems/next-greater-element-ii/
 */

var nextGreaterElements = function(nums) {
    let stack = [];
    let size = nums.length;
    let n = 2*nums.length - 1;
    let result = new Array(nums.length).fill(-1);

    for (let i = n; i >= 0; i--) {
        let index = i % size;
        while (stack.length > 0 && nums[stack.at(-1)] <= nums[index]) {
            stack.pop(); 
        }
        if (stack.length > 0) {
            result[index] = nums[stack.at(-1)];
        }
        stack.push(index);
    }
    return result;
};
