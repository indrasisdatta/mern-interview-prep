/**
 * 84. Largest rectangle in histogram
 * https://leetcode.com/problems/largest-rectangle-in-histogram/
 * @param {number[]} heights
 * @return {number}
 */
var largestRectangleArea = function(heights) {
    let stack = [], maxArea = 0;
    for (let h = 0; h < heights.length; h++) {
        let poppedElt = null;
        while (stack.length > 0 && heights[h] < stack[stack.length-1].height) {
            poppedElt = stack.pop();
            maxArea = Math.max(maxArea, poppedElt.height * (h - poppedElt.index));
        }
        stack.push({ 
            index: poppedElt ? poppedElt.index : h, 
            height: heights[h] 
        });
    }
    // console.log('Remaining stack: ', stack);
    let n = heights.length;
    while (stack.length > 0) {
        let poppedElt = stack.pop();
        maxArea = Math.max(maxArea, poppedElt.height * (n - poppedElt.index));
    }

    return maxArea;
};