/**
 * @param {number[]} nums
 * @param {number} k
 * @return {number[]}
 * Input: nums = [1,3,-1,-3,5,3,6,7], k = 3 
 * Output: [3,3,5,5,6,7]
 * APPROACH 1: Brute Force
 */
var maxSlidingWindow_brute_force = function(nums, k) {
  if (!nums || !Array.isArray(nums) || isNaN(k) || k < 0) {
    console.error('Invalid inputs');
    return;
  }
  let result = [];
  for (let start = 0; start < nums.length - k + 1; start++) {
    let max = nums[start];
    for (let inner = start+1; inner < start+k; inner++) {
      if (nums[inner] > max) {
        max = nums[inner];
      }
    }

    result.push(max);
  }
  return result;
};

console.log(maxSlidingWindow([1,3,-1,-3,5,3,6,7], 3));


/**
 * @param {number[]} nums
 * @param {number} k
 * @return {number[]}
 * Input: nums = [1,3,-1,-3,5,3,6,7], k = 3 
 * Output: [3,3,5,5,6,7]
 * APPROACH 2: Sliding Widow algorithm
 */
const maxSlidingWindow = function(nums, k) {
  if (!nums || !Array.isArray(nums) || isNaN(k) || k < 0) {
    console.error('Invalid inputs');
    return;
  }
  let dequeue = [], result = [];
  for (let start = 0; start < nums.length; start++) {
    /* dequeue can store k elements */
    if (dequeue.length > 0 && dequeue[0] <= start-k) {
      dequeue.shift();
    }
    /* Store indexes of max element, remove if value is less than current */
    while (dequeue.length > 0 && nums[start] > nums[dequeue[dequeue.length - 1]]) {
      dequeue.pop();
    }
    dequeue.push(start); 
    
    /* Window completely formed */
    if (start >= k-1) {
      result.push(nums[dequeue[0]])
    }
  }
  return result;
};

console.log(maxSlidingWindow([1,3,-1,-3,5,3,6,7], 3));
