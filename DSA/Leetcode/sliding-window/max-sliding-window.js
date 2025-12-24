/**
 * Optimal solution
 * https://leetcode.com/problems/sliding-window-maximum/
 */
const maxSlidingWindow = function(nums, k) {
    // [1,3,-1,-3,5,3,6,7], k = 3
    // [3,-1,-3] -> len=3  nums[i] > window[window.length - 1] -> window.pop()
    // [1,2,] window[0] <= i-k -> window.shift(), set max of 3 to result
    // [3,3] -> final result (max of 3)

    let window = [], result = [];
    for (let i = 0; i < nums.length; i++) {
        // As window moves forward, delete old entries
        if (window.length > 0 && window[0] <= i-k) {
            window.shift();
        }
        // Window keeps only max elements
        while (nums[i] > nums[window[window.length - 1]]) {
            window.pop();
        }
        window.push(i);
        if (i >= k-1) {
            result.push(nums[window[0]]);
        }
    }
    return result;
};

/**
 * BRUTE FORCE SOLUTION
 * https://leetcode.com/problems/sliding-window-maximum/
 * @param {number[]} nums
 * @param {number} k
 * @return {number[]}
 * 1,3,-1,-3,5,3,6,7,1,2,3 k=3 w=9 l=11
 * 
 */
var maxSlidingWindow_brute = function(nums, k) {
    let start = 0, window = [];
    for (let end = 0; end < nums.length; end++) {
        if (k + window.length === nums.length+1) {
            break;
        }
        let max = -Infinity;
        for (let sub = end; sub < k+end; sub++) {
            if (nums[sub] > max) {
                max = nums[sub];
            }
        }
        window.push(max);
    }
    return window;
};