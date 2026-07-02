/**
* @param {number[]} nums
* @return {number[][]}
*/
var threeSum = function(nums) {

    if (!nums || nums.length < 3) return [];

    let result = new Set();   
    let target = 0;

    // [-1,0,1,2,-1,-4] => [-4,-1,-1,0,1,2]
    nums = nums.sort((a, b) => a - b);

    for (let i = 0; i < nums.length; i++) {

        // Duplicate condition
        if (i > 0 && nums[i] === nums[i-1]) continue;

        let left = i + 1;
        let right = nums.length - 1;

        while (left < right) {
            if (nums[i] + nums[left] + nums[right] > target) {                
                right--;
            } else if (nums[i] + nums[left] + nums[right] < target) {
                left++;
            } else {
                result.add(
                    `${nums[i]},${nums[left]},${nums[right]}`
                );               
                left++;
                right--;
            }
        }
    }
    
    return [...result].map(item => item.split(',').map(n => Number(n)));
};