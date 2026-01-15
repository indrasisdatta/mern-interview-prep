/*
https://www.geeksforgeeks.org/dsa/reduce-the-string-by-removing-k-consecutive-identical-characters/
Input: K = 2, str = "geeksforgeeks" 
Output: gksforgks 
Explanation: After removal of both occurrences of the substring "ee", the string reduces to "gksforgks".

Input: K = 3, str = "qddxxxd" 
Output: q 
Explanation: Removal of "xxx" modifies the string to "qddd". Again, removal of "ddd" modifies the string to "q". 
*/

function removeKChar(k, str) {
    let stack = [];

    for (let i = 0; i < str.length; i++) {
        let ch = str[i];
        /* Consecutive chars - stack top matches the current char */
        if (stack.length > 0 && stack[stack.length-1].char === ch) {
            stack[stack.length-1].count++;
        } else {
            stack.push({ char: ch, count: 1 });
        }
        // [{q:1}, {d:2}, {x:3}]
        if (stack[stack.length-1].count === k) {
            stack.pop();
        }
    }
    return stack.map(({char, count}) => char.repeat(count)).join('');
}

console.log(removeKChar(3, "qddxxxd"))
console.log(removeKChar(3, "aaabbbcc"))

