/**
 * TWO SUM APPROACHES FOR UNSORTED ARRAYS 
 * ==========================================
 * 
 * Option A: The Hash Map Way
 * --------------------------
 * Description: You loop through the unsorted array exactly once, checking your map as you go.
 * 
 * Time Complexity : O(n) - Fast and linear.
 * Space Complexity: O(n) - Because you need memory to store the map.
 * 
 * 
 * Option B: The Two-Pointer Way (Requires Sorting First)
 * -----------------------------------------------------
 * Description: Because the two-pointer approach only works if the numbers 
 *              are in order, you would have to sort the array yourself 
 *              first using nums.sort().
 * 
 * Time Complexity : O(n log n) - Sorting takes O(n log n) time, which 
 *                                completely overrides the O(n) pointer loop.
 * Space Complexity: O(1) or O(n) - Depending on the language's sorting 
 *                                  algorithm implementation.
 * 
 * Verdict:
 * --------
 * For unsorted arrays, the Hash Map approach is superior because O(n) 
 * time is faster than O(n log n). Trading space for speed is preferred here.
 */

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
};

console.log(twoSum([2,3,4], 6));

/**
 * @param {number[]} numbers
 * @param {number} target
 * @return {number[]}
 */
var twoSum = function(numbers, target) {
    let left = 0, right = numbers.length - 1, result = [];
    while (left < right) {
        let sum = numbers[left] + numbers[right];
        if (sum === target) {
            return [ left+1, right+1 ];
        }
        if (sum < target) {
            left++;
        } else {
            right--;
        } 
    }   
    return result;
};