/**
 * https://leetcode.com/problems/valid-parentheses/
 * Valid Parentheses
 * @param {string} s
 * @return {boolean}
 */
const isValid = function(s) {
    let stack = [];
    for (let i = 0; i < s.length; i++) {
        let ch = s.charAt(i);

        // Push opening parenthesis 
        if (ch === '[' || ch === '{' || ch === '(') {
            stack.push(ch);
        } else if (ch === ']' || ch === '}' || ch === ')') {
            if (stack.length === 0) {
                return false;
            }
            const top = stack.pop();
            if (
                ch === ']' && top !== '[' || 
                ch === '}' && top !== '{' || 
                ch === ')' && top !== '(' 
            ) {
                return false;
            }
        }
    }
    return stack.length === 0;
};