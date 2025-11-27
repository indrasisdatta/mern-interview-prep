/**
 * https://leetcode.com/problems/best-time-to-buy-and-sell-stock/
 * @param {number[]} prices
 * @return {number}
 */
var maxProfit = function(prices) {
    let buyPrice = prices[0], maxProfit = 0;
    for (let k = 1; k < prices.length; k++) {
        const price = prices[k];
        let currProfit = 0;
        if (price < buyPrice) {
            buyPrice = price;
        } else {
            currProfit = price - buyPrice;
            maxProfit = Math.max(currProfit, maxProfit);  
        }              
    }
    return maxProfit;
};