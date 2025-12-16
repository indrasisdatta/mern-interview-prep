/**
 * 167. Two Sum II - Input Array Is Sorted
 * https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/
 * @param {number[]} numbers
 * @param {number} target
 * @return {number[]}
 */
var twoSum = function(numbers, target) {
    let start = 0;
    for (let end = numbers.length-1; end > start;) {
        if (numbers[start] + numbers[end] > target) {
            end--;
        } else if (numbers[start] + numbers[end] < target) {
            start++;
        } else {
            return [start+1, end+1];
        }
    }
};