/**
 * Container with most water 
 * https://leetcode.com/problems/container-with-most-water/
 * @param {number[]} height
 * @return {number}
 * [1,8,6,2,5,4,8,3,7] -> 49
 */
var maxArea = function(height) {
    let start = 0, end = height.length - 1;
    let maxArea = 0;
    while (start < end) {
        let currentArea;
        if (height[start] < height[end]) {
            currentArea = (end - start) * height[start];
            start++;
        } else {
            currentArea = (end - start) * height[end];
            end--;
        }
        if (currentArea > maxArea) {
            maxArea = currentArea;
        }
    }
    return maxArea;
};