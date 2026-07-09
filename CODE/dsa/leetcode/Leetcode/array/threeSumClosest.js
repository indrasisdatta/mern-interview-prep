/**
 * @param {number[]} nums
 * @param {number} target
 * @return {number}
 */
var threeSumClosest = function(nums, target) {
    
    // SORT initially: -1,2,1,-4 -> -4,-1,1,2
    // AFTER SORINTG: IF Sum < target, then start++ ELSE end--
    // CLOSEST LOGIC: Math.abs(target - currentSum)
    nums = nums.sort((a, b) => a - b);
    let closestSum = nums[0] + nums[1] + nums[2], 
        currentSum = 0;
    for (let i = 0; i < nums.length - 2; i++) {
        let start = i+1, end = nums.length - 1; 
        
        while (start < end) {
            currentSum = nums[i] + nums[start] + nums[end];
            if (currentSum < target) {
                start++;
            } else if (currentSum > target) {
                end--;
            } else {
                return currentSum;
            }

            if (Math.abs(target - currentSum) < Math.abs(target - closestSum)) {
                closestSum = currentSum;
            }
        }        
    }
    return closestSum;
};