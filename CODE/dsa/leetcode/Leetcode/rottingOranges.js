/**
 * https://leetcode.com/problems/rotting-oranges/
 * @param {number[][]} grid
 * @return {number}
 *
  2 1 1     2 2 1   2 2 2   2 2 2   2 2 2
  0 1 1     0 1 1   0 2 1   0 2 2   0 2 2
  1 0 1     1 0 1   1 0 1   1 0 1   1 0 2
 */
var orangesRotting = function(grid) {
    if (grid === null || grid.length === 0) return -1;

    let rows = grid.length, columns = grid[0].length;
    let time = new Array(rows);

    /* Helper grid - initialized with infinity */
    for (let i = 0; i < rows; i++) {
        time[i] = new Array(columns);
        for (let j = 0; j < columns; j++) {
            if (grid[i][j] === 1|| grid[i][j] === 2) {
                time[i][j] = Infinity;
            } else {
                time[i][j] = 0;
            }
        }
    }

    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < columns; j++) {
            /* For a rotten orange, call function to rot neighboring oranges */
            if (grid[i][j] === 2) {
                dfs(grid, time, i, j, 0);
            }
        }
    }
    
    let timeRequired = 0;
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < columns; j++) {
            if (grid[i][j] === 1) {
                /* This orange didn't get rotten */
                if (time[i][j] === Infinity) {
                    return -1;
                }
                timeRequired = Math.max(timeRequired, time[i][j]);
            }
        }
    }
    console.log(time, timeRequired)
    return timeRequired;
};

function dfs(grid, time, i, j, currentTime) {
    /* Boundary condition */
    if (i < 0 || j < 0 || i >= grid.length || j >= grid[0].length || grid[i][j] === 0 || currentTime >= time[i][j]) {
        return;
    }

    time[i][j] = currentTime;

    dfs(grid, time, i-1, j, currentTime+1);
    dfs(grid, time, i+1, j, currentTime+1);
    dfs(grid, time, i, j-1, currentTime+1);
    dfs(grid, time, i, j+1, currentTime+1);
}