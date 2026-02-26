/**
 * https://leetcode.com/problems/next-greater-element-i/description/
 * 496. Next Greater Element I
 * @param {number[]} nums1
 * @param {number[]} nums2
 * @return {number[]}
 * nums1 = [4,1,2] 
 * nums2 = [1,3,4,2]
 *  [2 (pop) 4  3  1 ] tempStack
 *  {2: -1, 4 : -1, 3: 4, 1: 3} nextGreaterMapping
 */
const nextGreaterElement = function(nums1, nums2) {
    if (!Array.isArray(nums1) || !Array.isArray(nums2) || nums1.length === 0 || nums2.length === 0) {
        return [];
    }
    let stack = [];
    let nextGreaterMapping = {};
    for (let i = nums2.length - 1; i >= 0; i--) {
        while (stack.length > 0 && stack[stack.length-1] <= nums2[i]) {
            stack.pop();
        }
        if (stack.length === 0) {
            stack.push(nums2[i]);
            nextGreaterMapping[nums2[i]] = -1;
        } else if (stack[stack.length-1] > nums2[i]) {           
            nextGreaterMapping[nums2[i]] = stack[stack.length-1];
            stack.push(nums2[i]);
        }
    }

    return nums1.map(num => nextGreaterMapping[num] || -1);
};