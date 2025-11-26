/**
 * https://leetcode.com/problems/longest-substring-without-repeating-characters/description/
 * Longest substring of non-repeating characters
 * Eg 1. abcabcbb -> 3 (abc)
 * Eg 2: pwwkew -> 3 (wke)
 * Eg 3: bbbb -> 1 (b)
 *
 * s[i] != s[i+1] charLen++
 */
const lengthOfLongestSubstring = function(s) {
    let charLen = 0;
    let maxLen = 0;
    let chars = '';
    for (let i = 0; i < s.length; i++) {
    	charLen = 0;
      chars = '';
    	for (let j = 0; j < s.length; j++) {
      	if (s[j] == s[j+1]) {
        	chars = '';
          charLen = 0;
        } else if (!chars.includes(s[j])) {
        	chars += s[j];
        	charLen++;
        }
        if (charLen > maxLen) {
        	maxLen = charLen;
        }
      }
    }
    return chars.length;
};

lengthOfLongestSubstring('abcabcbb');
lengthOfLongestSubstring('pwwkew');
lengthOfLongestSubstring('bbbbb');
