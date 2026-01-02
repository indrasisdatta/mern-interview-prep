/**
 * 124. Binary Tree Maximum Path Sum
 * https://leetcode.com/problems/binary-tree-maximum-path-sum/
 * Definition for a binary tree node.
 * function TreeNode(val, left, right) {
 *     this.val = (val===undefined ? 0 : val)
 *     this.left = (left===undefined ? null : left)
 *     this.right = (right===undefined ? null : right)
 * }
 */
/**
 * @param {TreeNode} root
 * @return {number}
 */
var maxPathSum = function(root) {

    let maxLen = root.val;

    function dfs(node) {
        if (!node) return 0;

        let leftMax = dfs(node.left);
        let rightMax = dfs(node.right);
        leftMax = Math.max(0, leftMax);
        rightMax = Math.max(0, rightMax);

        maxLen = Math.max(maxLen, leftMax + rightMax + node.val);

        return node.val + Math.max(leftMax, rightMax);
    }
    dfs(root);

    return maxLen;
};