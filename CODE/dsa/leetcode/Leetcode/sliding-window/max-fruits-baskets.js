/**
 * 904. Fruit Into Baskets
 * https://leetcode.com/problems/fruit-into-baskets/
 * @param {number[]} fruits
 * @return {number}
 */
var totalFruit = function(fruits) {
    let basketItems = new Map();
    let start = 0, maxLen = 0;

    for (let end = 0; end < fruits.length; end++) {
        /* Set item frequency */
        basketItems.set(fruits[end], (basketItems.get(fruits[end]) || 0)+1);

        /* Check window size */
        while (basketItems.size > 2) {
            let leftFruit = fruits[start];
            basketItems.set(leftFruit, basketItems.get(leftFruit)-1);
            if (basketItems.get(leftFruit) === 0) {
                basketItems.delete(leftFruit);
            }            
            start++;
        }
        maxLen = Math.max(maxLen, end-start+1);        
    }
    return maxLen;
};
