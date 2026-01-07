/**
 * 1921. Eliminate Maximum Number of Monsters
 * https://leetcode.com/problems/eliminate-maximum-number-of-monsters/
 * @param {number[]} dist
 * @param {number[]} speed
 * @return {number}
 */
var eliminateMaximum = function(dist, speed) {
    let times = [];
    let output = 0;
    for (let i in dist) {
        times.push(Math.ceil(dist[i]/speed[i])); 
    }
    times = times.sort((a, b) => a - b);
    // console.log('TImes => ', times)
    let totalTIme = 0;
    for (let i = 0; i < times.length; i++) {
        if (times[i] <= i) break;
        output++;
    }
    return output;
};