/**
 * Definition for isBadVersion()
 * https://leetcode.com/problems/first-bad-version/
 * @param {integer} version number
 * @return {boolean} whether the version is bad
 */
// const isBadVersion = function(version) {

// };


/**
 * @param {function} isBadVersion()
 * @return {function}
 */
var solution = function(isBadVersion) {
    /**
     * @param {integer} n Total versions
     * @return {integer} The first bad version
     */
    return function(n) {
        /* Binary search approach */
        let start = 1, end = n;        
        // let nums = new Array.from({ length: n }, (_, x) => x+1);

        while (start <= end) {            
            let mid = Math.floor((start + end)/2);
            if (isBadVersion(mid)) {
                end = mid;
            } else {
                start = mid + 1;
            }   
            if (start === end) {
                return start;
            }          
        }

        /* Linear search approach */
        // for (let i = 1; i <= n; i++) {
        //     if (isBadVersion(i)) return i;
        // }
        // return null;
    };
};