/**
 * 567. Permutation in String
 * https://leetcode.com/problems/permutation-in-string/
 * @param {string} s1
 * @param {string} s2
 * @return {boolean}
 */
var checkInclusion = function(s1, s2) {
    let s1Map = new Map();
    let s2Map = new Map();
    // Freq of S1 chars
    for (let ch of s1) {
        s1Map.set(ch, (s1Map.get(ch) || 0) + 1);
    }
    let start = 0;
    let windowSize = s1.length;
    let match = 0;
    for (let end = 0; end < s2.length; end++) {
        let ch = s2[end];
        s2Map.set(ch, (s2Map.get(ch) || 0) + 1);
        // If s1 doesn't contain, reset all entries and start fresh
        if (!s1Map.has(ch)) {
            s2Map.clear();
            match = 0;
            start = end + 1;
            continue;
        }
        // Matched frequency
        if (s1Map.get(ch) === s2Map.get(ch)) {
            match++;
        }
        // Window size matched
        if (end - start + 1 >= windowSize) {
            // Permutation string freq matched
            if (match === s1Map.size) return true;

            // Frequency didn't match, so slide window
            if (s1Map.get(s2[start]) === s2Map.get(s2[start])) {
                match--;
            }
            s2Map.set(s2[start], s2Map.get(s2[start]) - 1);
            start++;
        }        
    }
    return false;
}