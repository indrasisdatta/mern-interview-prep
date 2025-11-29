/**
 * 303. Range Sum Query - Immutable
 * https://leetcode.com/problems/range-sum-query-immutable/
 * @param {number[]} nums
 */
var NumArray = function(nums) {
    this.sum = [];
    let tempSum = 0;
    for (let i = 0; i < nums.length; i++) {
        tempSum += nums[i];
        this.sum.push(tempSum);
    }
};

/** 
 * @param {number} left 
 * @param {number} right
 * @return {number}
 */
NumArray.prototype.sumRange = function(left, right) {
    return left == 0 ? this.sum[right] : this.sum[right] - this.sum[left - 1];
};

/** 
 * Your NumArray object will be instantiated and called as such:
 * var obj = new NumArray(nums)
 * var param_1 = obj.sumRange(left,right)
 */