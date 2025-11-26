/**
 * https://leetcode.com/problems/find-the-difference/
 * @param {string} s
 * @param {string} t
 * @return {character}
 */
const findTheDifference = function(s, t) {
    if (!t) return "";
    if (!s) return t;

    let charMap = {};
    /* Store frequency of target */
    for (let ch of t) {
        charMap[ch] = (charMap[ch] || 0) + 1;
    }   
    for (let ch of s) {
        charMap[ch]--;
    } 
    return Object.keys(charMap).filter(ch => charMap[ch] > 0).join('');
};

findTheDifference("abcd", "abcde");
findTheDifference("", "t");
