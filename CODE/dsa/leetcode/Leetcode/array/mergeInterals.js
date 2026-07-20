/**
 * @param {number[][]} intervals
 * @return {number[][]}
 */
var merge = function(intervals) {
    // Sort by 0 pos
    // [[1,3],[2,6],[4,7],[8,10],[15,18]]   a[i][1] >= b[i+1][0]
    // [[1,6]], [4,7], [8,10], [15,18]]
    // [[1,7], [8,10], [15,18]]

    // Sort by first pos
    intervals.sort((a, b) => Number(a[0]) - Number(b[0]));

    let start = 0, result = [intervals[0]];

    for (let i = 1; i < intervals.length; i++) {
        let current = intervals[i];
        let lastMerged = result[result.length - 1];

        if (lastMerged[1] >= current[0]) {
            lastMerged[1] = Math.max(lastMerged[1], current[1]);
        } else {
            result.push(current);
        }
    }
    return result;
};