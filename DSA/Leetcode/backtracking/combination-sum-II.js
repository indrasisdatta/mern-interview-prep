/**
 * @param {number[]} candidates
 * @param {number} target
 * @return {number[][]}
 */
var combinationSum2 = function(candidates, target) {
    candidates = candidates.sort((a, b) => a - b);
    let subArr = [], result = [];
    let existingSubArr = new Set();

    function backtrack(index, sum = 0) {
        if (sum > target) return;
        if (sum === target) {
            result.push([...subArr]);   
            return;         
        }
        
        for (let i = index; i < candidates.length; i++) {
            /* Duplicates - at the same depth, don't pick same number twice */
            if (i > index && candidates[i] === candidates[i-1]) {
                continue;
            }
            if (sum + candidates[i] > target) {
                break;
            }

            subArr.push(candidates[i]);
            sum += candidates[i];
            backtrack(i+1, sum);
            sum -= candidates[i];
            subArr.pop();
        }
    }
    backtrack(0);

    return result;
};