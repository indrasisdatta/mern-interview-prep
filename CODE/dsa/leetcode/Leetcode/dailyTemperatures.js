/**
 * https://leetcode.com/problems/daily-temperatures/
 * @param {number[]} temperatures
 * @return {number[]}
 * 73,74,75,71,69,72,76,73
 * [ 73 (pop), 76, 72, 69(pop), 71,  ]
 * 75 -> pop 71, 72 -> [76, 75]
 * [ 0, 0, 1, 1, 2, 3, ]
 */
const dailyTemperatures = function(temperatures) {
    if (!temperatures || temperatures.length === 0) {
        return [];
    }
    let stack = [];
    let answer = [];
    for (let i = temperatures.length - 1; i >= 0; i--) {
        while (stack.length > 0 && stack[stack.length - 1].value <= temperatures[i]) {
            stack.pop();
        }
        if (stack.length === 0) {
            answer.push(0);
            stack.push({
                position: i,
                value: temperatures[i]
            });
        } else if (stack[stack.length - 1].value > temperatures[i]) {
            answer.push(stack[stack.length - 1].position - i);
            stack.push({
                position: i,
                value: temperatures[i]
            });
        } 
    }

    return answer.reverse()
};