/**
 * https://leetcode.com/problems/longest-substring-without-repeating-characters/description/
 * Longest substring of non-repeating characters
 * Eg 1. abcabcbb -> 3 (abc)
 * Eg 2: pwwkew -> 3 (wke)
 * Eg 3: bbbb -> 1 (b)
 *
 * s[i] != s[i+1] charLen++
 */
const lengthOfLongestSubstring_brute = function(s) {
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


var lengthOfLongestSubstring = function(s) {
    if (!s) return 0;
    if (s.length === 1) return 1;
    let currentMap = {};
    let start = 0;
    currentMap[s[start]] = 1;
    let longestChar = 0;
    for (let end = 1; end < s.length; end++) {
        while (s[end] in currentMap) {
            delete currentMap[s[start]];
            start++;            
        }
        currentMap[s[end]] = 1;
        longestChar = Math.max(longestChar, end - start + 1);
    }
    return longestChar;
}