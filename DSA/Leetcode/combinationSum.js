/**
 * @param {number[]} candidates
 * @param {number} target
 * @return {number[][]}
 */
var combinationSum = function(candidates, target) {
    let temp = [], result = [], sum = 0;
    backtrack(candidates, 0, target, [], result);

    console.log('Check result', result)
    return result;
};

function backtrack(candidates, start, remaining, temp, result) {

    if (remaining === 0) {   
        result.push([...temp]);  
        return;
    }
    if (remaining < 0) return;
    
    for (let i = start; i < candidates.length; i++) {        
        temp.push(candidates[i]);
        backtrack(candidates, i, remaining - candidates[i], temp, result);
        temp.pop();
    }
}