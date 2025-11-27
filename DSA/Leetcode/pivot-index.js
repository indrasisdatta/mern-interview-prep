/**
 * https://leetcode.com/problems/find-pivot-index/solutions/
 * @param {number[]} nums
 * @return {number}
 */
var pivotIndex = function(nums) {
    let leftSum = [];
    leftSum[0] = nums[0];
    let rightSum = new Array(nums.length);
    rightSum[rightSum.length - 1] = nums[nums.length-1];

    /* Calculate left sums */
    for (let i = 1; i < nums.length; i++) {
        leftSum[i] = nums[i] + leftSum[i-1];
    }
    /* Calculate right sums */
    for (let i = rightSum.length - 2; i >= 0; i--) {
        rightSum[i] = nums[i] + rightSum[i+1]
    }
    /* Find matching left and right sums */
    let matchingPos = -1;
    for (let i = 0; i < leftSum.length; i++) {
        if (leftSum[i] === rightSum[i]) {
            matchingPos = i;
            break;
        }
    }
    return matchingPos;
};