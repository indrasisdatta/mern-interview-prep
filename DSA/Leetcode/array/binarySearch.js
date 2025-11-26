/**
 * Binary search
 * https://leetcode.com/problems/binary-search/
 * @param {number[]} nums
 * @param {number} target
 * @return {number}
 * I/P: -1,0,3,5,9,12
 */
const search = function(nums, target) {
    if (!nums || nums.length === 0 || isNaN(target)) {
        return -1;
    }
    let start = 0, end = nums.length - 1;
    // -1,0,3,5,9,12
    // start = 0, end = 5, middle = 2
    // 3 == 9 (F) 3 < 9 (T) start = 2
    // middle = (2+5)/2 = 3
    // 5 < 9 (T) start = 3
    // middle = (3+5)/2 = 4
    // 9 == 9 (T)
    while (start <= end) {
        let middle = Math.floor((end + start) / 2);
        if (nums[middle] === target) {
            return middle;
        } else if (nums[middle] < target) {
            start = middle + 1;
        } else {
            end = middle - 1;
        }
    }
    return -1;
};
