/**
 * @param {string} s
 * @param {number} k
 * @return {number}
 */
const characterReplacement = function(s, k) {
  if (!s) {
    console.error('Invalid input string');
    return s;
  }
  if (isNaN(k) || k < 0) {
    console.error('Invalid k');
    return s;
  }
  let windowSize = 0;
  let start = 0;
  let charMapper = new Map();
  let maxFreq = 0;
  let maxLen = 0;

  for (let end = 0; end < s.length; end++) {
    
    let currentChar = s.charAt(end);
    /* Set frequency of each character */
    charMapper.set(currentChar, (charMapper.get(currentChar) || 0 ) + 1 );

    maxFreq = Math.max(maxFreq, charMapper.get(currentChar));
    
    /* Shrink window if it's invalid */
    while ((end - start + 1) - maxFreq > k) {
      charMapper.set(s[start], charMapper.get(s[start]) - 1);
      start++;
    }

    maxLen = Math.max(maxLen, (end - start + 1));
  }
  return maxLen;
};

console.log(characterReplacement("AABABBA", 1));
console.log(characterReplacement("ABAB", 2));

