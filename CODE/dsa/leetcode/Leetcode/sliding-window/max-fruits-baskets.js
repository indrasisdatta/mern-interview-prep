/**
 * 904. Fruit Into Baskets
 * https://leetcode.com/problems/fruit-into-baskets/
 * @param {number[]} fruits
 * @return {number}
 */
var totalFruit = function(fruits) {
    let basketCount = 2, start = 0, basketFruits = new Map();
    let maxLen = 0;
    for (let end = 0; end < fruits.length; end++) {
        // Already 2 are present and new type appears, then shift window start
        while (
            basketFruits.size === basketCount && 
            !basketFruits.has(fruits[end])
        ) {
            // console.log('Sliding condition:', basketFruits, fruits[end], start);
            basketFruits.set(
                fruits[start], 
                basketFruits.get(fruits[start]) - 1
            );
            // Remove entry entirely instead of keeping 0 count
            if (basketFruits.get(fruits[start]) === 0) {
                basketFruits.delete(fruits[start]);
            }       
            start++;
        }
        // Set frequency of each type
        basketFruits.set(
            fruits[end], 
            (basketFruits.get(fruits[end]) || 0) + 1
        );

        // Update max window so far
        maxLen = Math.max(maxLen, end - start + 1);
        // console.log('basketFruits', basketFruits);
        // console.log({ start, end, maxLen });
    }
    return maxLen;
};