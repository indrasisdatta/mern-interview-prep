/**
 * https://leetcode.com/problems/permutations/
 * @param {number[]} nums
 * @return {number[][]}
 */
var permute = function(nums) {
    let result = [];

    function backtrack(path, used) {
        console.log('Backtrack called!')
        if (path.length === nums.length) {
            // console.log('Pushing array:', path);
            result.push([...path]);
            return;
        }
        for (let i = 0; i < nums.length; i++) {
            // console.log('------------- Processing i=', i);
            if (used[i]) continue;

            // console.log('Debug =>', nums[i], path);

            used[i] = true;
            path.push(nums[i]);

            backtrack(path, used);

            path.pop();
            used[i] = false;
        }
    }

    backtrack([], new Array(nums.length).fill(false));
    return result;
};
