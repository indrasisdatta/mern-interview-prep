/**
 * Valid Anagram 
 * https://leetcode.com/problems/valid-anagram/
 * @param {string} s
 * @param {string} t
 * @return {boolean}
 */
const isAnagram = function(s, t) {
    if (!s || !t || s.length !== t.length) return false;

    let charMapper = {};

    for (let ch of s) {
      charMapper[ch] = (charMapper[ch] || 0) + 1;
    }

    for (ch of t) {
      if (!charMapper[ch]) {
        return false;
      }
      charMapper[ch]--;
    }
    return true;
};

console.log(isAnagram("anagram", "nagaram"));
console.log(isAnagram("rat", "car"));

