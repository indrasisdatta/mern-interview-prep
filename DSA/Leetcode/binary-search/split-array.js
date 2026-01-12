/**
 * 410. Split Array Largest Sum
 * https://leetcode.com/problems/split-array-largest-sum/
 * @param {number[]} nums
 * @param {number} k
 * @return {number}
 */
var splitArray = function(nums, k) {
    let low = Math.max(...nums);
    let high = nums.reduce((initial, acc) => initial + acc, 0);
    let res = high;
    while (low < high) {
        let mid = Math.floor((low + high) / 2);
        if (canSplit(mid)) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    function canSplit(largest) {
        let pieces = 1, sum = 0;
        for (num of nums) {
            if (sum + num > largest) {
                pieces++;
                sum = num;
            } else {
                sum += num;
            }
        }
        return pieces <= k;
    }
    return low;
};