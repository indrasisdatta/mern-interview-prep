/**
 * Definition for a binary tree node.
 */
// function TreeNode(val, left, right) {
//     this.val = (val===undefined ? 0 : val)
//     this.left = (left===undefined ? null : left)
//     this.right = (right===undefined ? null : right)
// }

/**
 * https://leetcode.com/problems/kth-smallest-element-in-a-bst/
 * @param {TreeNode} root
 * @param {number} k
 * @return {number}
 */
var kthSmallest = function(root, k) {
    let elemCount = 0, output = -1;
    function inorder(node) {
        if (!node) return;
        if (node.left) {
            inorder(node.left);
        }         
        elemCount++;
        if (elemCount === k) {
            output = node.val;
            return;
        }
        if (node.right) {
            inorder(node.right);
        } 
    }
    inorder(root);
    return output;
};