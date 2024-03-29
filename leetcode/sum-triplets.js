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
