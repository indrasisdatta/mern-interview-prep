/**
 * 78. Subsets
 * https://leetcode.com/problems/subsets/
 * @param {number[]} nums
 * @return {number[][]}
 *
 */
var subsets = function(nums) {
    if (nums.length === 0) return [];

    let result = [], subset = [];
    function subsetCombinations(index) {
        // console.log('Subset processing:', index, subset)
        result.push([...subset]);
        for (let i = index; i < nums.length; i++) {
            subset.push(nums[i]);       
            // console.log('Subset pushed:', subset);    
            subsetCombinations(i + 1);
            
            subset.pop();
            // console.log('Subset popped:', subset)
        }
    }    

    subsetCombinations(0);

    return result;
};

