/**
 * https://leetcode.com/problems/evaluate-reverse-polish-notation/
 * @param {string[]} tokens
 * @return {number}
 * 10 6 9 3
 * 10 6 12 (9+3) + appears
 * 10 6 12 -11 
 * 10 6 -132 * appears 
 * 10 (6/-132) / appears
 * 10 * 0   * appears
 */
var evalRPN = function(tokens) {
    const operators = ['+','-','/','*'];
    let stack = [];
    for (let token of tokens) {
        if (operators.includes(token) && stack.length >= 2) {            
            let lastElm1 = Number(stack.pop());
            let lastElm2 = Number(stack.pop());
            switch (token) {
                case '+':                        
                        stack.push(lastElm2 + lastElm1);
                    break;
                case '-':
                        stack.push(lastElm2 - lastElm1);
                    break;
                case '*':
                        stack.push(lastElm2 * lastElm1);
                    break;
                case '/':
                        stack.push(Math.trunc(lastElm2 / lastElm1));
                    break;
            }
        } else {
            stack.push(token);
        }
    }
    return stack.length > 0 ? Number(stack[0]) : 0;
};