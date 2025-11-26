/**
 * @param {number[]} nums
 * @param {number} target
 * @return {number[]}
 */
var twoSum = function(nums, target) {
    if (!nums || isNaN(target) || !Array.isArray(nums) || nums.length === 0) {
        console.error('Invalid input');
        return false;
    }
    let numMapper = new Map();
    /* Approach 1: Hash map approach */
    let result = [];
    for (let k = 0; k < nums.length; k++) {
        let num1 = nums[k];
        let num2 = target - num1;
        if (numMapper.has(num2)) {
            let num2Index = numMapper.get(num2);
            return k < num2Index ? [k, num2Index] : [num2Index, k];
        }
        numMapper.set(num1, k);
    }
    return result;

    /* Approach 2: Two pointer solution O(nlogn) as it works on sorted array only */
    nums.sort((a, b) => Number(a) - Number(b));
    let start = 0;
    let end = nums.length - 1;
    const output = [];
    while (start < end) {
        if (nums[start] + nums[end] === target) {
            return [start, end];
        }
        if (nums[start] + nums[end] < target) {
            start++;
        } else {
            end--;
        }
    }
    return output;
};

console.log(twoSum([2,3,4], 6));