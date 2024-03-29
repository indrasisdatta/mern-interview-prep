/**
 * Find distinct triplets whose sum = 0
 * Eg 1: 
 * 	Input: nums = [-1,0,1,2,-1,-4]
 * 	Output: [[-1,-1,2],[-1,0,1]]
 * Eg 2: [0,1,1] -> []
 * Eg 3: [0,0,0] -> [[0,0,0]] 
 */
 
 /**
   * @param {number[]} nums
   * @return {number[][]}
   */
  var threeSum = function(nums) {
    let len = nums.length;
    let output = [];
    let tempNos= [];
    for (let i = 0; i < len; i++) {
      for (let j = 0; j < len; j++) {
        for (let k = 0; k < len; k++) {
          let isExisting = checkExisting(tempNos, [nums[i], nums[j], nums[k]]);
          //console.log('TempNos unique', tempNos);
          //console.log('isExisting', i, j, k, isExisting);
          if (i != j && i != k && j != k && nums[i] + nums[j] + nums[k] === 0 && !isExisting) {
            let nos = [nums[i], nums[j], nums[k]].sort((a,b) => a-b);
            output.push(nos);
            tempNos.push(nos.join(''));
          }
        }
      }
    }
    console.log('Output: ', output);
    return output;
  };
  
  const checkExisting = (output, cur) => {
  	cur = cur.sort((a,b) => a-b).join('');
    return output.includes(cur);
  }
  
  threeSum([-1,0,1,2,-1,-4]);
  threeSum([0,0,0]);
  threeSum([0,1,1]);

/**
 * Hash set logic
 * (nums[i] + nums[j]) * (-1) -> check if already present
 */
 
 /**
   * @param {number[]} nums
   * @return {number[][]}
   */
  var threeSum = function(nums) {
  	if (nums.length < 3) return [];
    if (nums[0] === 0 && nums[1] === 0 && nums[2] === 0) return [ [0, 0, 0] ];
    let len = nums.length, 
    	  output = [], 
        tempNos= [],
        uniqueItems = new Map();
    for (let i = 0; i < len - 1; i++) {
      for (let j = i; j < len - 2; j++) {
      	let item = (nums[i] + nums[j]) * (-1);
      	if (uniqueItems.has(item) && !tempNos.includes(item)) {
        	tempNos.push(item);
        	output.push([nums[i], nums[j], item]);
        } else {
        	uniqueItems.set(nums[i]);
          uniqueItems.set(nums[j]);
        }
      }
    }
    console.log('Output: ', output);
    return output;
  };
    
  threeSum([-1,0,1,2,-1,-4]);
  threeSum([0,0,0]);
  threeSum([0,1,1]);
