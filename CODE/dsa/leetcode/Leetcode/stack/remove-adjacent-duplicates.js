/**
 * 1209. Remove All Adjacent Duplicates in String II
 * https://leetcode.com/problems/remove-all-adjacent-duplicates-in-string-ii/description/
 * @param {string} s
 * @param {number} k
 * @return {string}
 */
var removeDuplicates = function(s, k) {
    let stack = [], charMap = new Map();
    for (let ch of s) {
        let count = 0;
        // {p: 1} {b:2} {c:1}
        if (stack.length > 0 && stack[stack.length-1].char === ch) {
            stack[stack.length-1].count++;
            /* Remove k duplicates */
            if (stack[stack.length-1].count === k) {
                while (stack.length > 0 && stack[stack.length-1].char === ch) {
                    stack.pop(); 
                }
            } 
        } else {
            stack.push({ char: ch, count: 1 });
        }
    }
    // console.log(stack);
    return stack.map(({char, count}) => char.repeat(count)).join('');
};