/**
 * https://leetcode.com/problems/brick-wall/description/
 * @param {number[][]} wall
 * @return {number}
 */
var leastBricks = function(wall) {
    const gapMap = new Map();
    gapMap.set(0, 0);
    for (let row = 0; row < wall.length; row++) {
        let pos = 0;
        for (let col = 0; col < wall[row].length - 1; col++) {
            pos += wall[row][col];
            gapMap.set(pos, (gapMap.get(pos) || 0) + 1 );
        }
    } 
    return wall.length - Math.max(...gapMap.values());
};