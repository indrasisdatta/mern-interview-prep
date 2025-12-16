/**
 * 125. Valid Palindrome
 * https://leetcode.com/problems/valid-palindrome/description/
 * @param {string} s
 * @return {boolean}
 */
var isPalindrome = function(s) {
    s = s.replace(/[^0-9a-z]/gi, '')?.toLowerCase();
    let reversed = s.split('').reverse().join('');
    return s === reversed;
};