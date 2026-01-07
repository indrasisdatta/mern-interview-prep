/**
 * 3178. Find the Child Who Has the Ball After K Seconds
 * https://leetcode.com/problems/find-the-child-who-has-the-ball-after-k-seconds/
 * @param {number} n
 * @param {number} k
 * @return {number}
 */
var numberOfChild = function(n, k) {

    let cycle = 2 * (n-1);
    k = k % cycle;

    // n = 8, k = 5
    if (k < n) return k;

    // n = 5, k = 6 [0,1,2,3,4] -> 2
    // n=3, k=5 [0,1,2] -> 1
    
    return cycle - k;
};