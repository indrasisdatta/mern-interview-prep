/**
 * https://leetcode.com/problems/path-sum-ii/description/
 * Definition for a binary tree node.
 * function TreeNode(val, left, right) {
 *     this.val = (val===undefined ? 0 : val)
 *     this.left = (left===undefined ? null : left)
 *     this.right = (right===undefined ? null : right)
 * }
 */
/**
 * @param {TreeNode} root
 * @param {number} targetSum
 * @return {number[][]}
 */
var pathSum = function(root, targetSum) {
    let stack = [], result = [];
    function traverse(node, isRoot=false) {
        if (!node) return;
        
        stack.push(node.val);

        let stackSum = stack.reduce((initial, acc) => initial + acc, 0);

        if (!node.left && !node.right && stackSum === targetSum) {
            result.push([...stack]);
        }

        traverse(node?.left);
        traverse(node?.right);

        stack.pop();
    }

    traverse(root, true);
    
    return result;
}