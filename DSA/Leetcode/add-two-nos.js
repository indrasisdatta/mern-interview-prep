/**
 * https://leetcode.com/problems/add-two-numbers/description/
 * Definition for singly-linked list.
 * function ListNode(val, next) {
 *     this.val = (val===undefined ? 0 : val)
 *     this.next = (next===undefined ? null : next)
 * }
 */
 
/**
 * @param {ListNode} l1
 * @param {ListNode} l2
 * @return {ListNode}
 */
const addTwoNumbers = function(l1, l2) {
    let num1 = Number(l1.join(''));
    let num2 = Number(l2.join(''));
    let sum = (num1 + num2).toString().split('').map(n => Number(n));
    console.log('Result', sum)
};

addTwoNumbers([2,4,3], [5,6,4]);
addTwoNumbers([9,9,9,9,9,9,9], [9,9,9,9]);

/*
Input: l1 = [9,9,9,9,9,9,9], l2 = [9,9,9,9]
Output: [8,9,9,9,0,0,0,1]
 9999999
    9999
10009998 // reverse = 89990001
*/
