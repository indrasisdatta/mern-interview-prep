/**
 * @param {number[]} nums
 * @return {number[][]}
 * https://leetcode.com/problems/3sum/ * 
 */
const threeSum = function(nums) {
  if (!Array.isArray(nums) || nums.length < 3) {
    console.error('Invalid input');
    return [];
  }
  const targetSum = 0;
  nums = (nums.sort((a, b) => a-b));

  let combinations = new Set();

  for (let i = 0; i < nums.length - 2; i++) {
    let start = i+1;
    let end = nums.length - 1;
    while (start < end) {
      let sum = nums[i] + nums[start] + nums[end];
      if (sum < targetSum) {
        start++;
      } else if (sum > targetSum) {
        end--;
      } else {
        combinations.add(`${nums[i]}, ${nums[start]}, ${nums[end]}`);
        start++;
        end--;        
      }
    }
  }
  return [...combinations].map(c => c.split(', ').map(c => Number(c)));
};

console.log(threeSum([-1,0,1,2,-1,-4]));