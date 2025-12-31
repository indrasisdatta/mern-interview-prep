/**
 * 79. Word Search
 * https://leetcode.com/problems/word-search/
 * @param {character[][]} board
 * @param {string} word
 * @return {boolean}
 */
var exist = function(board, word) {

    let found = false;

    function dfs(i, j, wordIndex) {
        if (wordIndex === word.length) {
            found = true;
            return;
        }
        if (
            i < 0 || j < 0 || i >= board.length || j >= board[0].length || 
            board[i][j] !== word[wordIndex] || board[i][j] === '#' 
        ) {
            return;
        }
        wordIndex++;
        let temp = board[i][j];
        board[i][j] = '#';

        dfs(i-1, j, wordIndex);
        dfs(i+1, j, wordIndex);
        dfs(i, j-1, wordIndex);
        dfs(i, j+1, wordIndex);

        board[i][j] = temp;
    }

    for (let i = 0; i < board.length; i++) {
        for (let j = 0; j < board[i].length; j++) { 
            if (board[i][j] === word[0]) {
                dfs(i, j, 0);
                if (found) {
                    return true;
                }
            }
        }
    }
    return false;
};