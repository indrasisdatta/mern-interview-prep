/**
 * https://leetcode.com/problems/daily-temperatures/
 * @param {number[]} temperatures
 * @return {number[]}
 * 73,74,75,71,69,72,76,73
 * [ 73 (pop), 76, 72, 69(pop), 71,  ]
 * 75 -> pop 71, 72 -> [76, 75]
 * [ 0, 0, 1, 1, 2, 3, ]
 */
var dailyTemperatures = function(temperatures) {
    let monotonicStack = [], n = temperatures.length, result = new Array(n).fill(0);
    for (let i = n-1; i >= 0 ; i--) {

        while (monotonicStack.length > 0 && monotonicStack[monotonicStack.length - 1].value <= temperatures[i]) {
            monotonicStack.pop();
        }

        if (monotonicStack.length > 0) {
            result[i] =  monotonicStack[monotonicStack.length - 1].index - i;
        } else {
            result[i] = 0;
        }    

        monotonicStack.push({ index: i, value: temperatures[i] });   
    }

    return result;
};