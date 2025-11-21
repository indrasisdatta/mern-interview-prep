/**
 * https://leetcode.com/problems/first-unique-character-in-a-string/description/
 * @param {string} s
 * @return {number}
 */
const firstUniqChar = function(s) {
    if (!s) return -1;
    let freqMap = new Map();
    /* Set frequency of each character */
    for (let ch of s) {
        freqMap.set(
            ch,
            (freqMap.has(ch) ? freqMap.get(ch) : 0) + 1
        );
    }
    let uniqueIndex = -1;

    for (let key in s) {
        let ch = s[key];
        if (freqMap.get(ch) === 1) {
            uniqueIndex = Number(key);
        }
    }

    // indexOf causes O(n^2) in worst case 
    // for (let [ch, freq] of freqMap) {
    //     if (freq === 1) {
    //         uniqueIndex = s.indexOf(ch);
    //         break;
    //     }
    // }
    return uniqueIndex;
};