/**
 * https://leetcode.com/problems/validate-binary-search-tree/description/
 * Definition for a binary tree node.
 * function TreeNode(val, left, right) {
 *     this.val = (val===undefined ? 0 : val)
 *     this.left = (left===undefined ? null : left)
 *     this.right = (right===undefined ? null : right)
 * }
 */
/**
 * @param {TreeNode} root
 * @return {boolean}
 */

 var isValidBST = function(root) {
    let stack = [];
    let valid = true;
    let prev = null;
    function inorder(node) {
        if (!node) {
            return true;
        }
        if (!inorder(node.left)) {
            return false;
        }
        if (prev !== null && node.val <= prev) {
            console.log('Invalid detected', prev, node.val);
            return false;
        }
        prev = node.val;
        
        return inorder(node.right);
    }
    let res = inorder(root);
    return res;
};

var isValidBST_stack = function(root) {
    let stack = [];
    let valid = true;
    function inorder(node) {
        if (!valid) return valid;
        if (node.left) {            
            inorder(node.left);
        }
        if (stack[stack.length-1] >= node.val) {
            console.log('Invalid item:', node.val)
            stack = [];
            valid = false;
            return valid;
        }
        if (!valid) return valid;
        stack.push(node.val);
        if (node.right) {            
            inorder(node.right);
        } 
        return valid;       
    }
    let res = inorder(root);
    console.log(stack, res)
    return res;
};