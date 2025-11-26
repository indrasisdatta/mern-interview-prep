/**
 * https://leetcode.com/problems/ransom-note/
 * @param {string} ransomNote
 * @param {string} magazine
 * @return {boolean}
 */
const canConstruct = function(ransomNote, magazine) {
  if (!magazine || !ransomNote) return false;

  // let magazineCharFreq = {}, ransomCharFreq = {};
  let charFreq = {};
  for (let ch of magazine) {
    charFreq[ch] = (charFreq[ch] || 0) + 1;
  }
  for (let ch of ransomNote) {
    if (!charFreq[ch]) {
      return false;
    }
    charFreq[ch]--;
  }

  return true;
};

console.log(canConstruct("aa", "aab"));
console.log(canConstruct("a", "b"));
console.log(canConstruct("aa", "ab"));
