/**
 * Capacity To Ship Packages Within D Days
 * https://leetcode.com/problems/capacity-to-ship-packages-within-d-days/
 * @param {number[]} weights
 * @param {number} days
 * @return {number}
 *
 * weights = [3,2,2,4,1,4], days = 3
 */
const shipWithinDays = function(weights, days) {
    // let minWeight = Math.max(...weights);
    // let maxWeight = weights.reduce((initial, acc) => initial + acc, 0);
    let minWeight = 0, maxWeight = 0;
    for (let w of weights) {
        maxWeight += Number(w);
        if (minWeight < w) {
            minWeight = w;
        }
    }
    
    while (minWeight < maxWeight) {
        let calculatedDays = 1;
        let middle = minWeight  + Math.floor((maxWeight - minWeight) / 2);
        let sumOfWeights = 0;
        for (let weight of weights) {
            if (sumOfWeights + weight > middle) {
                sumOfWeights = 0;
                calculatedDays++;
            }
            sumOfWeights += weight;
        }
        if (calculatedDays > days) {
            minWeight = middle + 1;
        } else {
            maxWeight = middle;
        }        
    }

    return minWeight;
};