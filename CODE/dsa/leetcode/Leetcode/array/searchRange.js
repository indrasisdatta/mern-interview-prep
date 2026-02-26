/**
 * Find First and Last Position of Element in Sorted Array
 * https://leetcode.com/problems/find-first-and-last-position-of-element-in-sorted-array/
 * @param {number[]} nums
 * @param {number} target
 * @return {number[]}
 */
const searchRange = function(nums, target) {
    if (isNaN(target) || !Array.isArray(nums) || nums.length === 0) {
        return [-1, -1];
    }
    const leftIndex = searchElement(nums, target, 'left');
    const rightIndex = searchElement(nums, target, 'right');

    return [leftIndex, rightIndex];
};

const searchElement = (nums, target, type) => {
    let start = 0, end = nums.length - 1;
    let indexFound = -1;
    
    while (start <= end) {
        let middle = Math.floor((start + end) / 2);
        if (nums[middle] === target) {
            indexFound = middle;
            if (type == 'left') {
                end = middle - 1;
            } else {
                start = middle + 1;
            }              
        } else if (nums[middle] < target) {
            start = middle + 1;
        } else {
            end = middle - 1;
        }
    }
    return indexFound;
}