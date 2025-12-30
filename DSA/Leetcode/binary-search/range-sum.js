/**
 * Definition for a binary tree node.
 * function TreeNode(val, left, right) {
 *     this.val = (val===undefined ? 0 : val)
 *     this.left = (left===undefined ? null : left)
 *     this.right = (right===undefined ? null : right)
 * }
 */
/**
 * @param {TreeNode} root
 * @param {number} low
 * @param {number} high
 * @return {number}
 * [1, 3, 5, 6, 7, 10, 13, 15, 18] low = 6, high = 10 => 6 + 7 + 10 = 23
 */
var rangeSumBST = function(root, low, high) {
    let sum = 0;
    function inorder(node) {
        if (!node) return;

        // if (node.val < low) {
        //     inorder(node.right);
        //     return;
        // }
        // if (node.val > high) {
        //     inorder(node.left);
        //     return;
        // }

        if (node.left) {
            inorder(node.left);
        }
        if (node.val >= low && node.val <= high) {
            sum += node.val;
        }
        // stack.push(node.val);
        if (node.right) {
            inorder(node.right);
        }
        return sum;
    }

    return inorder(root);
};